const randomExt = require('random-ext');

const config = {
  stratName: 'fourema_stop_v2',
  gekkoConfig: {
    watch: {
      exchange: 'gdax',
      currency: 'EUR',
      asset: 'BTC'
    },

//    daterange: 'scan',

    daterange: {
      from: '2018-02-02',
      to: '2020-03-09'
    },

    simulationBalance: {
      'asset': 1,
      'currency': 1
    },

    slippage: 0.05,
    feeTaker: 0.25,
    feeMaker: 0.15,
    feeUsing: 'maker', // maker || taker

  },
  apiUrl: 'http://localhost:3000',

  // Population size, better reduce this for larger data
  populationAmt: 30,

  // How many completely new units will be added to the population (populationAmt * variation must be a whole number!!)
  variation: 0.5,

  // How many components maximum to mutate at once
  mutateElements: 20,

  // How many parallel queries to run at once
  parallelqueries: 5,

  // Min sharpe to consider in the profitForMinSharpe main objective
  minSharpe: 0.5,

  // profit || score || profitForMinSharpe
  // score = ideas? feedback?
  // profit = recommended!
  // profitForMinSharpe = same as profit but sharpe will never be lower than minSharpe
  // profitForTestFold = use average of profit and profit from test data (outside of training data)
  mainObjective: 'profitForTestFold',

  // K Fold values
  cyclesPerSet: 20,
  kFolds: 5,

  // optionally recieve and archive new all time high every new all time high
  notifications: {
    email: {
      enabled: false,
      receiver: 'destination@some.com',
      senderservice: 'gmail',
      sender: 'origin@gmail.com',
      senderpass: 'password',
    },
  },

  candleValues: [60,240,1440],
  getProperties: () => ({

    historySize: randomExt.integer(30, 10),
    weightone: randomExt.integer(10, 5),
    weighttwo: randomExt.integer(20, 11),
    weightthree: randomExt.integer(54, 21),
    weightfour: randomExt.integer(500, 55),
    stopLoss: randomExt.float(0, -0.5),
    moveStopLossProf: randomExt.float(1, 0),

    candleSize: randomExt.pick(config.candleValues)
  })
};

module.exports = config;
