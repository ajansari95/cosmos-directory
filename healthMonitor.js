import PQueue from 'p-queue';
import axios from 'axios';
import _ from 'lodash'

const ERROR_COOLDOWN = 3 * 60
const ALLOWED_DELAY = 5 * 60
const ALLOWED_ERRORS = 2

class MonitorQueue {
	constructor() {
		this._queue = [];
	}

	enqueue(run, options) {
    if(options.address){
      _.remove(this._queue, el => el.address === options.address);
      const runData = {
        address: options.address,
        run: run
      }
      this._queue.push(runData);
    }
	}

	dequeue() {
		return this._queue.shift()?.run;
	}

	get size() {
		return this._queue.length;
	}

	filter(options) {
		return this._queue;
	}
}

const HealthMonitor = () => {
  const queue = new PQueue({ concurrency: 20, queueClass: MonitorQueue });

  function size(){
    return queue.size
  }

  function clear(){
    queue.clear()
  }

  function checkUrl(url, type, chainId, currentUrl){
    const request = () => {
      const start = Date.now();
      return axios.get(url.address + '/' + urlPath(type), { timeout: 10000 })
        .then(res => res.data)
        .then(data => {
          const responseTime = Date.now() - start
          return buildUrl(type, chainId, url, currentUrl, data, responseTime);
        }).catch(error => {
          const responseTime = Date.now() - start
          return buildUrl(type, chainId, url, currentUrl, undefined, responseTime, error.message);
        });
    }
    return queue.add(request, {address: url.address})
  }

  function urlPath(type) {
    return type === 'rest' ? 'blocks/latest' : 'block';
  }

  function buildUrl(type, chainId, url, currentUrl, data, responseTime, error) {
    let blockTime, blockHeight
    if(!error){
      ({ error, blockTime, blockHeight } = checkHeader(type, data, chainId))
    }

    let { lastError, lastErrorAt, available } = currentUrl
    let errorCount = currentUrl.errorCount || 0
    if(error){
      if (available) errorCount++
      lastError = error
      lastErrorAt = Date.now()
    }else if(errorCount > 0){
      const currentTime = Date.now()
      const cooldownDate = (currentTime - 1000 * ERROR_COOLDOWN)
      if(lastErrorAt <= cooldownDate){
        errorCount = 0
      }
    }

    const nowAvailable = errorCount <= ALLOWED_ERRORS && (!error || !!currentUrl.available)
    if(available && !nowAvailable){
      timeStamp('Removing', chainId, type, url.address, error);
    }else if(!available && nowAvailable){
      timeStamp('Adding', chainId, type, url.address);
    }else if(available && error){
      timeStamp('Failed', chainId, type, url.address, error);
    }
    
    return { 
      url, 
      lastError,
      lastErrorAt,
      errorCount,
      available: nowAvailable, 
      blockHeight: blockHeight, 
      blockTime: blockTime,
      responseTime
    };
  }

  function checkHeader(type, data, chainId){
    let error, blockTime
    if (data && type === 'rpc')
      data = data.result;

    const header = data.block.header
    if (header.chain_id !== chainId)
      error = 'Unexpected chain ID: ' + header.chain_id

    blockTime = Date.parse(header.time)
    const currentTime = Date.now()
    if(!error && blockTime < (currentTime - 1000 * ALLOWED_DELAY))
      error = 'Unexpected block delay: ' + (currentTime - blockTime) / 1000

    let blockHeight = parseInt(header.height)

    return {blockTime, blockHeight, error: error}
  }

  function timeStamp(...args) {
    console.log('[' + new Date().toISOString().substring(11, 23) + '] -', ...args);
  }

  return {
    checkUrl,
    clear,
    size
  }
}

export default HealthMonitor
