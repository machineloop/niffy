/*jshint esnext:true*/

var debug = require('debug')('niffy');
var Nightmare = require('nightmare');
var mkdirp = require('mkdirp');
var fs = require('fs');
var thunkify = require('thunkify');
var defaults = require('defaults');
var sprintf = require('sprintf-js').sprintf;
var diff = require('./lib/diff');

/**
 * Export `Niffy`
 */

module.exports = Niffy;

/**
 * Initialize `Nightmare`
 *
 * @param {String} base
 * @param {String} test
 * @param {Object} options
 */

function Niffy(base, test, options) {
  if (!(this instanceof Niffy)) return new Niffy(base, test, options);
  options = defaults(options, { show: false, width: 1400, height: 1000, threshold: .2, imgfiledir: '/tmp/niffy' });
  this.nightmare = new Nightmare(options);
  this.basehost = base;
  this.testhost = test;
  this.starts = {};
  this.profiles = {};
  this.errorThreshold = options.threshold;
  this.imgfiledir = options.imgfiledir;
}

/**
 * Generate a test function.
 *
 * @param {String} path
 * @param {Function} fn
 */

Niffy.prototype.test = async function (path, fn, fn2) {
  var diff = await this.capture(path, fn, fn2);
  var pct = '' + Math.floor(diff.percentage * 10000) / 10000 + '%';
  var failMessage = sprintf('%s different, open %s', pct, diff.diffFilepath);
  var absolutePct = Math.abs(diff.percentage);
  if (diff.percentage > this.errorThreshold) {
    throw new Error(failMessage);
  }
};

/**
 * goto a specific path and optionally take some actions.
 *
 * @param {String} path
 * @param {Function} fn to run on base
 * @param {Function} fn to run on test
 */

Niffy.prototype.goto = async function (path, fn, fn2) {
  var testFn = (typeof fn2 === 'function') ? fn2 : fn;
  this.startProfile('goto');
  await this.gotoHost(this.basehost, path, fn);
  await this.gotoHost(this.testhost, path, testFn);
  this.stopProfile('goto');
};

/**
 * goto for a specific host, optionally take some actions.
 *
 * @param {String} host
 * @param {String} path
 * @param {Function} fn
 */

Niffy.prototype.gotoHost = async function (host, path, fn) {
  var name = (host === this.basehost) ? 'base' : 'test';
  await this.nightmare.goto(host + path);
  if (fn) {
    await timeout(1000);
    await fn(this.nightmare, name);
    await timeout(1000);
  }
};

/**
 * continue with same nightmare state.
 * 
 * @param {Function} fn
 */

Niffy.prototype.continue = async function (fn) {
  await fn(this.nightmare);
};

/**
 * capture a specific path after optionally taking some actions.
 *
 * @param {String} path
 * @param {Function} fn to run on base url
 * @param {Function} fn to run on test url
 */

Niffy.prototype.capture = async function (path, fn, fn2) {
  var testFn = (typeof fn2 === 'function') ? fn2 : fn;
  /**
   * Capture the screenshots.
   */

  await this.captureHost('base', this.basehost, path, fn);
  await this.captureHost('test', this.testhost, path, testFn);

  /**
   * Run the diff calculation.
   */

  this.startProfile('diff');
  var pathA = imgfilepath('base', path, this.imgfiledir);
  var pathB = imgfilepath('test', path, this.imgfiledir);
  var pathDiff = imgfilepath('diff', path, this.imgfiledir);
  var result = await diff(pathA, pathB, pathDiff);
  this.stopProfile('diff');

  /**
   * Prep the results.
   */

  result.percentage = result.differences / result.total * 100;
  result.diffFilepath = imgfilepath('diff', path, this.imgfiledir);
  return result;
};

/**
 * capture for a specific host name + host, and optionally take some actions.
 *
 * @param {String} name
 * @param {String} host
 * @param {String} path
 * @param {Function} fn
 */

Niffy.prototype.captureHost = async function (name, host, path, fn) {

  this.startProfile('goto');
  await this.gotoHost(host, path, fn);
  this.stopProfile('goto');

  this.startProfile('capture');
  await this.nightmare.wait(1000).screenshot(imgfilepath(name, path, this.imgfiledir));
  this.stopProfile('capture');
  await timeout(250);
};

/**
 * End the capture session.
 */

Niffy.prototype.end = async function () {
  await this.nightmare.end();

  debug(
    'profile\n\tgoto %s\n\tcapture %s\n\tdiff %s',
    this.profiles.goto,
    this.profiles.capture,
    this.profiles.diff
  );
};

/**
 * Mark an execution start time.
 *
 * @param {String} name
 */

Niffy.prototype.startProfile = function (name) {
  var start = new Date().getTime();
  this.starts[name] = start;
};

/**
 * Mark an execution stop time.
 *
 * @param {String} name
 */

Niffy.prototype.stopProfile = function (name) {
  var end = new Date().getTime();
  if (!this.starts[name]) return;
  if (this.profiles[name]) this.profiles[name] += (end - this.starts[name]);
  else this.profiles[name] = (end - this.starts[name]);
};

/**
 * Utils
 */

function imgfilepath(name, path, imgfiledir) {
  var filepath = imgfiledir + path;
  if (filepath.slice(-1) !== '/') filepath += '/';
  mkdirp(filepath);
  return (filepath + name + '.png');
}

async function timeout(ms) {
  var to = function (ms, cb) {
    setTimeout(function () { cb(null); }, ms);
  };
  await thunkify(to)(ms);
}
