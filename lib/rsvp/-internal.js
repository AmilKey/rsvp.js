import {
  objectOrFunction,
  isFunction,
  now
} from './utils';

import instrument from './instrument';

import { config } from "./config";

function noop() {}

var PENDING   = void 0;
var SEALED    = 0;
var FULFILLED = 1;
var REJECTED  = 2;

var GET_THEN_ERROR = new ErrorObject();

function getThen(promise) {
  try {
    return promise.then;
  } catch(error) {
    GET_THEN_ERROR.error = error;
    return GET_THEN_ERROR;
  }
}

function tryThen(then, value, fulfillmentHandler, rejectionHandler) {
  try {
    then.call(value, fulfillmentHandler, rejectionHandler);
  } catch(e) {
    return e;
  }
}

function handleThenable(promise, maybeThenable) {
  var then = null, resolved;

  then = getThen(maybeThenable);

  if (then === GET_THEN_ERROR) {
    reject(promise, GET_THEN_ERROR.error);
    return false;
  }

  if (then === undefined) {
    return false;
  }

  if (isFunction(then)) {
    var error = tryThen(then, maybeThenable, function(value) {
      if (resolved) { return true; }
      resolved = true;

      if (maybeThenable !== value) {
        resolve(promise, value);
      } else {
        fulfill(promise, value);
      }
    }, function(reason) {
      if (resolved) { return true; }
      resolved = true;

      reject(promise, reason);
    }, 'Settle: ' + (promise._label || ' unknown promise'));

    if (resolved) { return true; }

    if (error) {
      reject(promise, error);
      return false;
    }

    return true;
  }
  return false;
}

function resolve(promise, value) {
  if (promise === value) {
    fulfill(promise, value);
  } else if (!(objectOrFunction(value) && handleThenable(promise, value))) {
    fulfill(promise, value);
  }
}

function publishFulfillment(promise) {
  publish(promise, promise._state = FULFILLED);
}

function publishRejection(promise) {
  if (promise._onerror) {
    promise._onerror(promise._result);
  }

  publish(promise, promise._state = REJECTED);
}

function fulfill(promise, value) {
  if (promise._state !== PENDING) { return; }

  promise._result = value;

  if (promise._subscribers.length === 0) {
    promise._state = FULFILLED;
    if (config.instrument) {
      instrument('fulfilled', promise);
    }
  } else {
    promise._state = SEALED;
    config.async(publishFulfillment, promise);
  }
}

function reject(promise, reason) {
  if (promise._state !== PENDING) { return; }

  promise._result = reason;
  promise._state = SEALED;

  config.async(publishRejection, promise);
}

function subscribe(parent, child, onFulfillment, onRejection) {
  var subscribers = parent._subscribers;
  var length = subscribers.length;

  subscribers[length] = child;
  subscribers[length + FULFILLED] = onFulfillment;
  subscribers[length + REJECTED]  = onRejection;

  if (length === 0 && parent._state) {
    config.async(parent._state === FULFILLED ? publishFulfillment : publishRejection, parent);
  }
}

function publish(promise, settled) {
  var subscribers = promise._subscribers;

  if (config.instrument) {
    instrument(settled === FULFILLED ? 'fulfilled' : 'rejected', promise);
  }

  if (subscribers.length === 0) { return; }

  var child, callback, detail = promise._result;

  for (var i = 0; i < subscribers.length; i += 3) {
    child = subscribers[i];
    callback = subscribers[i + settled];

    if (child) {
      invokeCallback(settled, child, callback, detail);
    } else {
      callback(detail);
    }
  }

  promise._subscribers.length = 0;
}

function subscribe(parent, child, onFulfillment, onRejection) {
  var subscribers = parent._subscribers;
  var length = subscribers.length;

  subscribers[length] = child;
  subscribers[length + FULFILLED] = onFulfillment;
  subscribers[length + REJECTED]  = onRejection;

  if (length === 0 && parent._state) {
    config.async(parent._state === FULFILLED ? publishFulfillment : publishRejection, parent);
  }
}

function ErrorObject() {
  this.error = null;
}

var TRY_CATCH_ERROR = new ErrorObject();

function tryCatch(callback, detail) {
  try {
    return callback(detail);
  } catch(e) {
    TRY_CATCH_ERROR.error = e;
    return TRY_CATCH_ERROR;
  }
}


function invokeCallback(settled, promise, callback, detail) {
  var hasCallback = isFunction(callback),
      value, error, succeeded, failed;

  if (hasCallback) {
    value = tryCatch(callback, detail);

    if (value === TRY_CATCH_ERROR) {
      failed = true;
      error = value.error;
      value = null;
    } else {
      succeeded = true;
    }

    if (promise === value) {
      reject(promise, new TypeError('A promises callback cannot return that same promise.'));
      return;
    }

  } else {
    value = detail;
    succeeded = true;
  }

  if (hasCallback && succeeded) {
    resolve(promise, value);
  } else if (failed) {
    reject(promise, error);
  } else if (settled === FULFILLED) {
    resolve(promise, value);
  } else if (settled === REJECTED) {
    reject(promise, value);
  }
}

function initializePromise(promise, resolver) {
  function resolvePromise(value) {
    resolve(promise, value);
  }

  function rejectPromise(reason) {
    reject(promise, reason);
  }

  try {
    resolver(resolvePromise, rejectPromise);
  } catch(e) {
    rejectPromise(e);
  }
}

export {
  noop,
  resolve,
  reject,
  fulfill,
  subscribe,
  publish,
  publishFulfillment,
  publishRejection,
  initializePromise
};
