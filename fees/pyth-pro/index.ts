import { Dependencies, FetchOptions, SimpleAdapter } from "../../adapters/types";
import { CHAIN } from "../../helpers/chains";
import { queryDuneSql } from "../../helpers/dune";

// Douro Labs is the official Pyth Pro data distributor
// Revenue split: Douro Labs keeps 40%, Pyth DAO receives 60%
// Note: These are wallet OWNER addresses, not token account addresses
// Dune's tokens_solana.transfers uses owner addresses in from_owner/to_owner fields
const DOURO_LABS_WALLET = "2ru31e9g8RF2mSSNgTQ11QMb166NE6LJccmBqGJM8xxy";
const PYTH_DAO_WALLET = "Gx4MBPb1vqZLJajZmsKLg8fGw9ErhoKsR8LeKcCKFyak";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const PYTH_MINT = "HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3";

// Revenue split percentages
const DAO_SHARE = 0.6;  // 60% goes to Pyth DAO
const DOURO_SHARE = 0.4; // 40% kept by Douro Labs

const fetch = async (_t: any, _a: any, options: FetchOptions) => {
  const dailyRevenue = options.createBalances();
  const dailyFees = options.createBalances();
  const dailySupplySideRevenue = options.createBalances();

  // Query USDC and PYTH transfers from Douro Labs wallet to Pyth DAO wallet
  const query = `
    SELECT
      token_mint_address,
      COALESCE(SUM(amount), 0) as total_amount
    FROM tokens_solana.transfers
    WHERE block_time BETWEEN FROM_UNIXTIME(${options.startTimestamp}) AND FROM_UNIXTIME(${options.endTimestamp})
      AND token_mint_address IN ('${USDC_MINT}', '${PYTH_MINT}')
      AND from_owner = '${DOURO_LABS_WALLET}'
      AND to_owner = '${PYTH_DAO_WALLET}'
    GROUP BY token_mint_address
  `;

  const res = await queryDuneSql(options, query);

  for (const tokenFees of res) {
    const daoAmount = BigInt(tokenFees.total_amount);
    
    // DAO receives 60%, so gross = daoAmount / 0.6
    // Using integer math: gross = daoAmount * 100 / 60
    const grossAmount = (daoAmount * 100n) / 60n;
    
    // Douro's cut = gross - daoAmount (or gross * 0.4)
    const douroAmount = grossAmount - daoAmount;

    // dailyFees = gross subscription revenue (100%)
    dailyFees.add(tokenFees.token_mint_address, grossAmount);
    
    // dailyRevenue = what Pyth DAO receives (60%)
    dailyRevenue.add(tokenFees.token_mint_address, daoAmount);
    
    // dailySupplySideRevenue = Douro Labs' cut (40%)
    dailySupplySideRevenue.add(tokenFees.token_mint_address, douroAmount);
  }

  return {
    dailyFees,
    dailyRevenue,
    dailySupplySideRevenue,
  };
};

const adapter: SimpleAdapter = {
  version: 1,
  fetch,
  chains: [CHAIN.SOLANA],
  start: "2025-01-01",
  dependencies: [Dependencies.DUNE],
  isExpensiveAdapter: true,
  methodology: {
    Fees: "Total Pyth Pro subscription revenue (USDC and PYTH payments). Calculated as DAO revenue / 0.6 to derive gross.",
    Revenue: "Pyth DAO's 60% share of Pyth Pro subscription revenue from Douro Labs.",
    SupplySideRevenue: "Douro Labs' 40% share as the official Pyth Pro data distributor.",
  },
};

export default adapter;
