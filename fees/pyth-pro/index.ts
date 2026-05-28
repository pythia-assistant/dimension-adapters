import { Dependencies, FetchOptions, SimpleAdapter } from "../../adapters/types";
import { CHAIN } from "../../helpers/chains";
import { queryDuneSql } from "../../helpers/dune";

// Douro Labs is the official Pyth Pro data distributor
// Revenue split: Douro Labs keeps 40%, Pyth DAO receives 60%
const DOURO_LABS_WALLET = "2ru31e9g8RF2mSSNgTQ11QMb166NE6LJccmBqGJM8xxy";
const PYTH_DAO_WALLET = "Gx4MBPb1vqZLJajZmsKLg8fGw9ErhoKsR8LeKcCKFyak";

// Pyth Purchases program: DAO uses revenue to buy PYTH from market
// Ops multisig executes swaps and returns PYTH to treasury
const PYTH_DAO_TREASURY_SPL = "9HKkxg5dpqjUEW1U2r76SpQCH7uvDMciytNYxrpwMVNc";
const PYTHIAN_OPS_MULTISIG = "GAdn7TZhszf5KTfwNRx3A2nP6KCRFEWucZubgdEqbJA2";

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const PYTH_MINT = "HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3";

// Revenue split percentages
const DAO_SHARE = 0.6;  // 60% goes to Pyth DAO
const DOURO_SHARE = 0.4; // 40% kept by Douro Labs

const fetch = async (_t: any, _a: any, options: FetchOptions) => {
  const dailyRevenue = options.createBalances();
  const dailyFees = options.createBalances();
  const dailySupplySideRevenue = options.createBalances();
  const dailyHoldersRevenue = options.createBalances();

  // Query 1: USDC and PYTH transfers from Douro Labs to Pyth DAO (subscription revenue)
  const subscriptionQuery = `
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

  const subscriptionRes = await queryDuneSql(options, subscriptionQuery);

  for (const tokenFees of subscriptionRes) {
    const daoAmount = BigInt(tokenFees.total_amount);
    
    // DAO receives 60%, so gross = daoAmount * 100 / 60
    const grossAmount = (daoAmount * 100n) / 60n;
    const douroAmount = grossAmount - daoAmount;

    dailyFees.add(tokenFees.token_mint_address, grossAmount);
    dailyRevenue.add(tokenFees.token_mint_address, daoAmount);
    dailySupplySideRevenue.add(tokenFees.token_mint_address, douroAmount);

    // PYTH payments from Pyth Pro count as holder revenue
    if (tokenFees.token_mint_address === PYTH_MINT) {
      dailyHoldersRevenue.add(PYTH_MINT, daoAmount);
    }
  }

  // Query 2: PYTH purchases - tokens returned from Ops Multisig to Treasury
  // This captures PYTH bought on market with protocol revenue
  const purchasesQuery = `
    SELECT
      COALESCE(SUM(amount), 0) as total_amount
    FROM tokens_solana.transfers
    WHERE block_time BETWEEN FROM_UNIXTIME(${options.startTimestamp}) AND FROM_UNIXTIME(${options.endTimestamp})
      AND token_mint_address = '${PYTH_MINT}'
      AND from_owner = '${PYTHIAN_OPS_MULTISIG}'
      AND to_owner = '${PYTH_DAO_TREASURY_SPL}'
  `;

  const purchasesRes = await queryDuneSql(options, purchasesQuery);
  const purchasesAmount = purchasesRes[0]?.total_amount || 0;

  if (purchasesAmount > 0) {
    dailyHoldersRevenue.add(PYTH_MINT, purchasesAmount);
  }

  return {
    dailyFees,
    dailyRevenue,
    dailySupplySideRevenue,
    dailyHoldersRevenue,
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
    Fees: "Total Pyth Pro subscription revenue (100%). Calculated as DAO revenue / 0.6 to derive gross.",
    Revenue: "Pyth DAO's 60% share of subscription revenue from Douro Labs.",
    SupplySideRevenue: "Douro Labs' 40% share as the official data distributor.",
    HoldersRevenue: "PYTH tokens accruing to the DAO: (1) PYTH payments from Pyth Pro subscriptions, (2) PYTH purchased on market via the Pyth Purchases program.",
  },
};

export default adapter;
