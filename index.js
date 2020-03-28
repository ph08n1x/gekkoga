const async = require('async');
const nodemailer = require('nodemailer');
const randomExt = require('random-ext');
const rp = require('request-promise');
const { some } = require('bluebird');
const fs = require('fs-extra');
const flat = require('flat');
const util = require('util');
const moment = require('moment');

class Ga {

  constructor({ gekkoConfig, stratName, mainObjective, populationAmt, parallelqueries, minSharpe, variation, mutateElements, notifications, getProperties, apiUrl, cyclesPerSet, kFolds }, configName ) {
    this.configName = configName.replace(/\.js|config\//gi, "");
    this.stratName = stratName;
    this.mainObjective = mainObjective;
    this.getProperties = getProperties;
    this.apiUrl = apiUrl;
    this.sendemail = notifications.email.enabled;
    this.senderservice = notifications.email.senderservice;
    this.sender = notifications.email.sender;
    this.senderpass = notifications.email.senderpass;
    this.receiver = notifications.email.receiver;
    this.currency = gekkoConfig.watch.currency;
    this.asset = gekkoConfig.watch.asset;
    this.previousBestParams = null;
    this.populationAmt = populationAmt;
    this.parallelqueries = parallelqueries;
    this.minSharpe = minSharpe;
    this.variation = variation;
    this.mutateElements = mutateElements;
    this.baseConfig = {
      watch: gekkoConfig.watch,
      paperTrader: {
        slippage: gekkoConfig.slippage,
        feeTaker: gekkoConfig.feeTaker,
        feeMaker: gekkoConfig.feeMaker,
        feeUsing: gekkoConfig.feeUsing,
        simulationBalance: gekkoConfig.simulationBalance,
        reportRoundtrips: true,
        enabled: true
      },
      writer: {
        enabled: false,
        logpath: ''
      },
      tradingAdvisor: {
        enabled: true,
        method: this.stratName,
      },
      trader: {
        enabled: false,
      },
      backtest: {
        daterange: gekkoConfig.daterange
      },
      backtestResultExporter: {
        enabled: true,
        writeToDisk: false,
        data: {
          stratUpdates: false,
          roundtrips: false,
          stratCandles: true,
          stratCandleProps: [
            'close',
            'start'
          ],
          trades: false
        }
      },
      performanceAnalyzer: {
        riskFreeReturn: 5,
        enabled: true
      },
      valid: true
    };

    // Cross validation vars
    this.cyclesPerSet = cyclesPerSet;
    this.currCycle = 1;
    this.kFoldsNumber = kFolds;
    this.kFoldsSets = [];
    // Now split date into k fold parts
    if (gekkoConfig.daterange && gekkoConfig.daterange.from && gekkoConfig.daterange.to) {
      const from = moment.utc(gekkoConfig.daterange.from);
      const to = moment.utc(gekkoConfig.daterange.to);
      const diffInMs = Math.abs(moment(from).diff(to));
      const foldTimeRange = diffInMs / this.kFoldsNumber;

      for(let i = 1; i <= this.kFoldsNumber; i++) {
        this.kFoldsSets.push({
          from: moment(from).add(foldTimeRange * (i - 1), 'ms').utc().format(),
          to: moment(from).add(foldTimeRange * i, 'ms').utc().format()
        });
        moment(from).add(foldTimeRange * i, 'ms')
      }
    }
    else {
      console.log('No from or to dates for K-fold date range cross validation')
    }



  }

  // Checks for, and if present loads old .json parameters
  async loadBreakPoint() {

    const fileName = `./results/${this.configName}-${this.currency}_${this.asset}.json`;
    const exists = fs.existsSync(fileName);

    if(exists){

      console.log('Previous config found, loading...');
      return fs.readFile(fileName, 'utf8').then(JSON.parse);

    }

    return false;

  }

  // Allows queued execution via Promise
  queue(items, parallel, ftc) {

    const queued = [];

    return Promise.all(items.map((item) => {

      const mustComplete = Math.max(0, queued.length - parallel + 1);
      const exec = some(queued, mustComplete).then(() => ftc(item));
      queued.push(exec);

      return exec;

    }));

  }

  // Creates a random gene if prop='all', creates one random property otherwise
  createGene(prop) {
    // Is first generation, and previous props available, load them as a start-point
    if (this.previousBestParams === null || this.runstarted) {
      let properties = flat.flatten(this.getProperties());
      return prop === 'all' ? flat.unflatten(properties) : properties[prop];
    } else if ( this.previousBestParams.parameters && !this.runstarted) {
      this.runstarted = 1;
      let properties = flat.flatten(this.previousBestParams.parameters);
      return prop === 'all' ? flat.unflatten(properties) : properties[prop];
    } else {
      throw Error('Could not resolve a suitable state for previousBestParams');
    }
  }

  // Creates random population from genes
  createPopulation() {
    let population = [];

    for (let i = 0; i < this.populationAmt; i++) {

      population.push(this.createGene('all'));

    }

    return population;
  }

  // Pairs two parents returning two new childs
  crossover(a, b) {

    let len = Object.keys(a).length;
    let crossPoint = randomExt.integer(len - 1, 1);
    let tmpA = {};
    let tmpB = {};
    let currPoint = 0;

    for (let i in a) {

      if (a.hasOwnProperty(i) && b.hasOwnProperty(i)) {

        if (currPoint < crossPoint) {

          tmpA[i] = a[i];
          tmpB[i] = b[i];

        } else {

          tmpA[i] = b[i];
          tmpB[i] = a[i];

        }

      }

      currPoint++;

    }

    return [tmpA, tmpB];
  }

  // Mutates object a at most maxAmount times
  mutate(a, maxAmount) {

    let amt = randomExt.integer(maxAmount, 0);
    // flatten, mutate, return unflattened object
    let flattened = flat.flatten(a);
    let allProps = Object.keys(flattened);

    for (let i = 0; i < amt; i++) {
      let position = randomExt.integer(Object.keys(allProps).length - 1, 0);
      let prop = allProps[position];
      flattened[prop] = this.createGene(prop);
    }

    return flat.unflatten(flattened);
  }

  calcFitness(i, totalProfit, totalTestProfit) {
    // TODO: Make fn that works
    // IF PROFIT > 0 GOOD
    // IF PROFIT < 0 BAD

  }

  // For the given population and fitness, returns new population and max score
  runEpoch(population, populationProfits, populationSharpes, populationScores, populationTestProfits) {
    let selectionProb = [];
    let fitnessSum = 0;
    let testFitnessSum = 0;
    let maxFitness = [0, 0, 0, 0, -10000];

    for (let i = 0; i < this.populationAmt; i++) {

      if (this.mainObjective === 'score') {

        if (populationProfits[i] < 0 && populationSharpes[i] < 0) {

          populationScores[i] = (populationProfits[i] * populationSharpes[i]) * -1;

        } else {

          populationScores[i] = Math.tanh(populationProfits[i] / 3) * Math.tanh(populationSharpes[i] / 0.25);

        }

        if (populationScores[i] > maxFitness[2]) {

          maxFitness = [populationProfits[i], populationSharpes[i], populationScores[i], i, 0];

        }

      } else if (this.mainObjective === 'profit') {

        if (populationProfits[i] > maxFitness[0]) {

          maxFitness = [populationProfits[i], populationSharpes[i], populationScores[i], i, 0];

        }

      } else if (this.mainObjective === 'profitForMinSharpe') {

        if (populationProfits[i] > maxFitness[0] && populationSharpes[i] >= this.minSharpe) {

          maxFitness = [populationProfits[i], populationSharpes[i], populationScores[i], i, 0];

        }

      } else if (this.mainObjective === 'profitForTestFold') {
        // console.log(`Prof ${populationProfits[i]} > ${maxFitness[0]} && ${populationTestProfits[i]} > ${maxFitness[4]}`);
        if (populationProfits[i] > maxFitness[0] && populationTestProfits[i] >= maxFitness[4]) {

          maxFitness = [populationProfits[i], populationSharpes[i], populationScores[i], i, populationTestProfits[i]];

        }
      }
    }

    // If one profit is negative then change range to start from 0
    const lowestProf = Math.min.apply(null, populationProfits);
    // console.log(lowestProf);
    if (lowestProf < 0) {
      populationProfits.forEach((prof, i) => {
        populationProfits[i] += -lowestProf;
        populationProfits[i] = populationProfits[i];
      });
    }
    fitnessSum = populationProfits.reduce((tot, el) => tot + el);

    const lowestTestProf = Math.min.apply(null, populationTestProfits);
    // console.log(lowestTestProf);
    if (lowestTestProf < 0) {
      populationTestProfits.forEach((prof, i) => {
        populationTestProfits[i] += -lowestTestProf;
      });
    }
    testFitnessSum = populationTestProfits.reduce((tot, el) => tot + el);

    console.log('Fitness sum:', fitnessSum);
    console.log('Test fitness sum:', testFitnessSum);
    if (fitnessSum === 0) {

      for (let j = 0; j < this.populationAmt; j++) {

        selectionProb[j] = 1 / this.populationAmt;

      }

    } else {
      for (let j = 0; j < this.populationAmt; j++) {
        const currEpochFitness = populationProfits[j] / fitnessSum;
        if (testFitnessSum !== 0) {
          console.log(`Candidate ${j}; fitness: ${currEpochFitness}, test fit: ${populationTestProfits[j] / testFitnessSum}, profit: ${populationProfits[j]}, test prof: ${populationTestProfits[j]}`);
        }
        selectionProb[j] = testFitnessSum === 0 ? currEpochFitness : (((currEpochFitness + (populationTestProfits[j] / testFitnessSum)) / 2));
      }

    }

    console.log('selection probs: ', selectionProb);
    const selectionProbSum = selectionProb.reduce((tot,val) => tot + val);
    console.log('sum of probs: ', selectionProbSum);

    let newPopulation = [];

    while (newPopulation.length < this.populationAmt * (1 - this.variation)) {

      let a, b;
      let selectedProb = randomExt.float(selectionProbSum, 0);
      // console.log('pre select prop: ',selectedProb);

      for (let k = 0; k < this.populationAmt; k++) {
        // console.log('select pop prop:', selectionProb[k]);
        selectedProb -= selectionProb[k];

        // console.log('select prop: ',selectedProb);

        if (selectedProb <= 0) {

          a = population[k];
          break;

        }

      }
      selectedProb = randomExt.float(selectionProbSum, 0);

      for (let k = 0; k < this.populationAmt; k++) {

        selectedProb -= selectionProb[k];

        if (selectedProb <= 0) {

          b = population[k];
          break;

        }

      }

      // console.log('a:', a);
      // console.log('b:', b);

      let res = this.crossover(this.mutate(a, this.mutateElements), this.mutate(b, this.mutateElements));
      newPopulation.push(res[0]);
      newPopulation.push(res[1]);

    }

    for (let l = 0; l < this.populationAmt * this.variation; l++) {

      newPopulation.push(this.createGene('all'));

    }

    return [newPopulation, maxFitness];
  }

  getConfig(data) {

    const conf = Object.assign({}, this.baseConfig);

    conf[this.stratName] = Object.keys(data).reduce((acc, key) => {
      acc[key] = data[key];
      return acc;
    }, {});

    Object.assign(conf.tradingAdvisor, {
      candleSize: data.candleSize,
      historySize: data.historySize
    });

    return conf;

  }

  // Calls api for every element in testSeries and returns gain for each
  async fitnessApi(testsSeries, isTestSet = false) {

    const numberOfParallelQueries = this.parallelqueries;

    const results = await this.queue(testsSeries, numberOfParallelQueries, async (data) => {

      const outconfig = this.getConfig(data);

      // TODO: use correct fold date range depending on cycle
      if (isTestSet) {
        outconfig.backtest.daterange.from = this.kFoldsSets[this.currCycle].from;
        outconfig.backtest.daterange.to = this.kFoldsSets[this.currCycle].to;
        console.log(`Using test fold: ${outconfig.backtest.daterange.from} TO ${outconfig.backtest.daterange.to}`);
      }
      else {
        outconfig.backtest.daterange.from = this.kFoldsSets[0].from;
        outconfig.backtest.daterange.to = this.kFoldsSets[this.currCycle].to;
        console.log(`Normal train fold: ${outconfig.backtest.daterange.from} TO ${outconfig.backtest.daterange.to}`);
      }


      const body = await rp.post({
        url: `${this.apiUrl}/api/backtest`,
        json: true,
        body: outconfig,
        headers: { 'Content-Type': 'application/json' },
        timeout: 3600000
      });

      // These properties will be outputted every epoch, remove property if not needed
      const properties = ['balance', 'profit', 'sharpe', 'market', 'relativeProfit', 'yearlyProfit', 'relativeYearlyProfit', 'startPrice', 'endPrice', 'trades'];
      const report = body.performanceReport;
      let result = { profit: 0, metrics: false };

      if (report) {

        let picked = properties.reduce((o, k) => {

          o[k] = report[k];

          return o;

        }, {});

        result = { profit: body.performanceReport.profit, sharpe: body.performanceReport.sharpe, metrics: picked };

      }

      return result;

    });

    let scores = [];
    let profits = [];
    let sharpes = [];
    let otherMetrics = [];

    for (let i in results) {

      if (results.hasOwnProperty(i)) {

        scores.push(results[i]['profit'] * results[i]['sharpe']);
        profits.push(results[i]['profit']);
        sharpes.push(results[i]['sharpe']);
        otherMetrics.push(results[i]['metrics']);

      }

    }

    return { scores, profits, sharpes, otherMetrics };

  }

  async run() {
    // Check for old break point
    const loaded_config = await this.loadBreakPoint();
    let population = this.createPopulation();
    let epochNumber = 0;
    let populationScores;
    let populationProfits;
    let populationSharpes;
    let populationTestProfits;
    let otherPopulationMetrics;
    let allTimeMaximum = {
      parameters: {},
      score: -5,
      profit: -5,
      testProfit: -5000000,
      sharpe: -5,
      epochNumber: 0,
      otherMetrics: {},
    };
    let finishAllFolds = false;


    if (loaded_config) {

      console.log(`Loaded previous config from ${this.configName}-${this.currency}_${this.asset}.json`);
      this.previousBestParams = loaded_config;

      epochNumber = this.previousBestParams.epochNumber;
      populationScores = this.previousBestParams.score;
      populationProfits = this.previousBestParams.profit;
      populationSharpes = this.previousBestParams.sharpe;
      otherPopulationMetrics = this.previousBestParams.otherMetrics;
      populationTestProfits = this.previousBestParams.testProfit;
      allTimeMaximum = {
        parameters: this.previousBestParams.parameters,
        score: this.previousBestParams.score,
        profit: this.previousBestParams.profit,
        sharpe: this.previousBestParams.sharpe,
        epochNumber: this.previousBestParams.epochNumber,
        otherMetrics: this.previousBestParams.otherMetrics,
        testProfit: this.previousBestParams.testProfit,
      };

      console.log('Resuming previous run...');

    } else {

      console.log('No previous run data, starting from scratch!');

    }

    console.log(`Starting GA with epoch populations of ${this.populationAmt}, running ${this.parallelqueries} units at a time!`);

    while (!finishAllFolds) {

      const startTime = new Date().getTime();
      const res = await this.fitnessApi(population);

      if (parseInt(epochNumber / this.cyclesPerSet) > (this.currCycle - 1)) {
        const testRes = await this.fitnessApi(population, true);
        populationTestProfits = testRes.profits;
        this.currCycle++;
        // Update cycle, finish if we gone through all folds
        if (this.currCycle === this.kFoldsNumber) {
          finishAllFolds = true;
          console.log('========== FINAL TEST =============');
        }
      }
      else {
        populationTestProfits = new Array(population.length).fill(0);
      }

      populationScores = res.scores;
      populationProfits = res.profits;
      populationSharpes = res.sharpes;
      otherPopulationMetrics = res.otherMetrics;

      let endTime = new Date().getTime();
      epochNumber++;
      let results = this.runEpoch(population, populationProfits, populationSharpes, populationScores, populationTestProfits);
      let newPopulation = results[0];
      let maxResult = results[1];
      let score = maxResult[2];
      let profit = maxResult[0];
      let sharpe = maxResult[1];
      let position = maxResult[3];
      let testProfit = maxResult[4];

      this.notifynewhigh = false;
      if (this.mainObjective == 'score') {
        if (score >= allTimeMaximum.score) {
          this.notifynewhigh = true;
          allTimeMaximum.parameters = population[position];
          allTimeMaximum.otherMetrics = otherPopulationMetrics[position];
          allTimeMaximum.score = score;
          allTimeMaximum.profit = profit;
          allTimeMaximum.sharpe = sharpe;
          allTimeMaximum.epochNumber = epochNumber;
        }
      } else if (this.mainObjective == 'profit') {
        if (profit >= allTimeMaximum.profit) {
          this.notifynewhigh = true;
          allTimeMaximum.parameters = population[position];
          allTimeMaximum.otherMetrics = otherPopulationMetrics[position];
          allTimeMaximum.score = score;
          allTimeMaximum.profit = profit;
          allTimeMaximum.sharpe = sharpe;
          allTimeMaximum.epochNumber = epochNumber;

        }
      } else if (this.mainObjective == 'profitForMinSharpe') {
        if (profit >= allTimeMaximum.profit && sharpe >= this.minSharpe) {
          this.notifynewhigh = true;
          allTimeMaximum.parameters = population[position];
          allTimeMaximum.otherMetrics = otherPopulationMetrics[position];
          allTimeMaximum.score = score;
          allTimeMaximum.profit = profit;
          allTimeMaximum.sharpe = sharpe;
          allTimeMaximum.epochNumber = epochNumber;

        }
      } else if (this.mainObjective == 'profitForTestFold') {
        if (testProfit !== 0 && testProfit > allTimeMaximum.testProfit) {
          this.notifynewhigh = true;
          allTimeMaximum.parameters = population[position];
          allTimeMaximum.otherMetrics = otherPopulationMetrics[position];
          allTimeMaximum.score = score;
          allTimeMaximum.profit = profit;
          allTimeMaximum.sharpe = sharpe;
          allTimeMaximum.epochNumber = epochNumber;
          allTimeMaximum.testProfit = testProfit;
        }
      }

      console.log(`
    --------------------------------------------------------------
    Cycle Number: ${this.currCycle} / ${this.kFoldsNumber}
    Epoch number: ${epochNumber}
    Time it took (seconds): ${(endTime - startTime) / 1000}
    Max score: ${score}
    Max profit: ${profit} ${this.currency}
    Max Test profit: ${testProfit} ${this.currency}
    Max sharpe: ${sharpe}
    Max profit position: ${position}
    Max parameters:
    `,
        util.inspect(population[position], false, null),
        `
    Other metrics:
    `,
        otherPopulationMetrics[position]);

      // Prints out the whole population with its fitness,
      // useful for finding properties that make no sense and debugging
      // for(let element in population){
      //
      //     console.log('Fitness: '+populationProfits[element]+' Properties:');
      //     console.log(population[element]);
      //
      // }

      console.log(`
    --------------------------------------------------------------
    Global Maximums:
    Score: ${allTimeMaximum.score}
    Profit: ${allTimeMaximum.profit} ${this.currency}
    Test Profit: ${allTimeMaximum.testProfit}
    Sharpe: ${allTimeMaximum.sharpe}
    parameters: \n\r`,
        util.inspect(allTimeMaximum.parameters, false, null),
        `
    Global maximum so far:
    `,
        allTimeMaximum.otherMetrics,
        `
    --------------------------------------------------------------
    `);

      // store in json
      const json = JSON.stringify(allTimeMaximum);
      await fs.writeFile(`./results/${this.configName}-${this.currency}_${this.asset}.json`, json, 'utf8').catch(err => console.log(err) );

      if (this.sendemail && this.notifynewhigh) {
        var transporter = nodemailer.createTransport({
          service: this.senderservice,
          auth: {
            user: this.sender,
            pass: this.senderpass
          }
        });
        var mailOptions = {
          from: this.sender,
          to: this.receiver,
          subject: `Profit: ${allTimeMaximum.profit} ${this.currency}`,
          text: json
        };
        transporter.sendMail(mailOptions, function(error, info){
          if (error) {
            console.log(error);
          } else {
            console.log('Email sent: ' + info.response);
          }
        });
      }


      population = newPopulation;

    }

    console.log(`Finished!
  All time maximum:
  ${allTimeMaximum}`);

  }

}


module.exports = Ga;
