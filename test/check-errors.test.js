'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const https = require('node:https');
const Module = require('node:module');
const test = require('node:test');

const originalLoad = Module._load;
Module._load = function(request, parent, isMain)
{
    if (request === 'homey')
    {
        return { App: class {} };
    }
    if (request === './homey-api' && parent.filename.endsWith('app.js'))
    {
        return { HomeyAPIApp: class {
            constructor({ homey })
            {
                this.apps = homey.apps;
            }
        } };
    }
    return originalLoad.call(this, request, parent, isMain);
};
let MyApp;
try
{
    MyApp = require('../app');
}
finally
{
    Module._load = originalLoad;
}
const api = require('../api');

function makeApp()
{
    const app = new MyApp();
    app.errors = [];
    app.log = () => {};
    app.error = (...args) => app.errors.push(args);
    app.homey = {
        settings: { get: () => [], set: () => {} },
        api: { realtime: () => {} },
        apps: { getApps: async () => ({}) },
        notifications: { createNotification: async () => {} },
        __: key => key
    };
    return app;
}

test('response stream failures reject and are logged by the store request', async () =>
{
    const app = makeApp();
    const originalGet = https.get;
    try
    {
        for (const event of ['error', 'aborted', 'close'])
        {
            https.get = (url, options, callback) =>
            {
                const request = new EventEmitter();
                process.nextTick(() =>
                {
                    const response = new EventEmitter();
                    callback(response);
                    response.emit(event, new Error('connection lost'));
                    if (event === 'aborted')
                    {
                        response.emit('error', new Error('socket reset'));
                        response.emit('close');
                    }
                });
                return request;
            };
            assert.equal(await app.GetURLorRedirect('https://homey.app/test', {}), null);
            assert.equal(app.errors.length, ['error', 'aborted', 'close'].indexOf(event) + 1);
        }
    }
    finally
    {
        https.get = originalGet;
    }
});

test('successful responses and HTTP redirects still work', async () =>
{
    const app = makeApp();
    const originalGet = https.get;
    const urls = [];
    try
    {
        https.get = (url, options, callback) =>
        {
            urls.push(url);
            const request = new EventEmitter();
            process.nextTick(() =>
            {
                const response = new EventEmitter();
                response.statusCode = urls.length === 1 ? 302 : 200;
                response.headers = { location: '/redirected' };
                callback(response);
                response.emit('data', Buffer.from('store page'));
                response.emit('end');
                response.emit('close');
            });
            return request;
        };
        assert.deepEqual(await app.GetURLorRedirect('https://homey.app/original', {}), {
            url: 'https://homey.app/redirected',
            res: 'store page'
        });
        assert.deepEqual(urls, ['https://homey.app/original', 'https://homey.app/redirected']);
        assert.equal(app.errors.length, 0);
    }
    finally
    {
        https.get = originalGet;
    }
});

test('request deadline destroys stalled requests before and after response headers', async () =>
{
    const app = makeApp();
    const originalGet = https.get;
    const originalSetTimeout = global.setTimeout;
    const originalClearTimeout = global.clearTimeout;
    let timer;
    let cleared;
    let request;
    try
    {
        global.setTimeout = (callback, delay) =>
        {
            assert.equal(delay, 30000);
            timer = { callback };
            return timer;
        };
        global.clearTimeout = value => { cleared = value; };

        for (const withHeaders of [false, true])
        {
            https.get = (url, options, callback) =>
            {
                request = new EventEmitter();
                request.destroy = err =>
                {
                    request.destroyedWith = err;
                    request.emit('error', err);
                };
                if (withHeaders)
                {
                    process.nextTick(() => callback(new EventEmitter()));
                }
                return request;
            };
            const result = app.GetURLorRedirect('https://homey.app/stalled', {});
            await new Promise(resolve => process.nextTick(resolve));
            timer.callback();
            assert.equal(await result, null);
            assert.equal(cleared, timer);
            assert.equal(request.destroyedWith.message, 'HTTPS request timed out after 30000 ms');
            assert.equal(app.errors[app.errors.length - 1][2].err, request.destroyedWith);
        }
    }
    finally
    {
        https.get = originalGet;
        global.setTimeout = originalSetTimeout;
        global.clearTimeout = originalClearTimeout;
    }
});

test('successful and failed requests clear the deadline', async () =>
{
    const app = makeApp();
    const originalGet = https.get;
    const originalSetTimeout = global.setTimeout;
    const originalClearTimeout = global.clearTimeout;
    const timers = [];
    const cleared = [];
    try
    {
        global.setTimeout = (callback, delay) =>
        {
            const timer = { callback, delay };
            timers.push(timer);
            return timer;
        };
        global.clearTimeout = timer => cleared.push(timer);
        https.get = (url, options, callback) =>
        {
            const request = new EventEmitter();
            process.nextTick(() =>
            {
                const response = new EventEmitter();
                response.statusCode = 200;
                callback(response);
                response.emit('data', Buffer.from('ok'));
                response.emit('end');
            });
            return request;
        };
        assert.equal(await app.GetURL('https://homey.app/success', {}), 'ok');
        https.get = () => { throw new Error('request setup failed'); };
        await assert.rejects(app.GetURL('https://homey.app/failure', {}));
        assert.deepEqual(cleared, timers);
    }
    finally
    {
        https.get = originalGet;
        global.setTimeout = originalSetTimeout;
        global.clearTimeout = originalClearTimeout;
    }
});

test('a timed-out store check releases the lock and allows another check', async () =>
{
    const app = makeApp();
    const originalGet = https.get;
    const originalSetTimeout = global.setTimeout;
    const originalClearTimeout = global.clearTimeout;
    try
    {
        app.homey.apps.getApps = async () => ({
            'app.id': { name: 'App', version: '1.0.0', origin: 'appstore' }
        });
        global.setTimeout = (callback, delay) =>
        {
            assert.equal(delay, 30000);
            process.nextTick(callback);
            return {};
        };
        global.clearTimeout = () => {};
        https.get = () =>
        {
            const request = new EventEmitter();
            request.destroy = err => request.emit('error', err);
            return request;
        };
        assert.equal(await app.checkNow(false), true);
        assert.equal(app.checking, false);
        assert.equal(app.errors.length, 2);
        app.homey.apps.getApps = async () => ({});
        assert.equal(await app.checkNow(false), true);
        assert.equal(app.checking, false);
    }
    finally
    {
        https.get = originalGet;
        global.setTimeout = originalSetTimeout;
        global.clearTimeout = originalClearTimeout;
    }
});

test('trigger and notification failures are logged without losing updates', async () =>
{
    const app = makeApp();
    app.getAthomStoreAppInfo = async () => ({ releaseVersion: '2.0.0', testVersion: '2.0.0' });
    app.appUpdateTrigger = { trigger: () => { throw new Error('trigger failed'); } };
    app.homey.notifications.createNotification = async () => { throw new Error('notification failed'); };
    const updates = [];
    await app.compareAthomStoreVersion('app.id', { name: 'App', version: '1.0.0' }, true, [], updates);
    assert.equal(updates.length, 1);
    assert.deepEqual(app.errors.map(error => error[0]), [
        'Failed to fire update trigger',
        'Failed to create update notification'
    ]);

    app.appUpdateTrigger.trigger = async () => { throw new Error('trigger rejected'); };
    app.homey.notifications.createNotification = () => { throw new Error('notification threw'); };
    await app.compareAthomStoreVersion('app.id', { name: 'App', version: '1.0.0' }, true, [], updates);
    assert.equal(updates.length, 2);
    assert.deepEqual(app.errors.slice(2).map(error => error[0]), [
        'Failed to fire update trigger',
        'Failed to create update notification'
    ]);
});

test('check errors release the lock and report failure', async () =>
{
    const app = makeApp();
    const messages = [];
    app.homey.settings.get = async () => { throw new Error('settings failed'); };
    app.homey.api.realtime = async (event, data) => messages.push(data);
    assert.equal(await app.checkNow(false), true);
    assert.equal(app.checking, false);
    assert.deepEqual(messages, [{ status: 'settings failed' }]);
    assert.equal(app.errors[0][0], 'Update check failed');

    app.homey.settings.get = () => [];
    app.homey.settings.set = async () => { throw new Error('save failed'); };
    assert.equal(await app.checkNow(false), true);
    assert.equal(app.checking, false);
    assert.deepEqual(messages[messages.length - 1], { status: 'save failed' });
});

test('check handles realtime rejections and a subsequent check succeeds', async () =>
{
    const app = makeApp();
    app.homey.api.realtime = async () => { throw new Error('realtime failed'); };
    assert.equal(await app.checkNow(false), true);
    assert.equal(app.checking, false);
    assert.deepEqual(app.errors.map(error => error[0]), [
        'Update check failed',
        'Failed to report update check status'
    ]);

    const messages = [];
    app.homey.api.realtime = async (event, data) => messages.push(data);
    assert.equal(await app.checkNow(false), true);
    assert.equal(app.checking, false);
    assert.deepEqual(messages[messages.length - 1], { status: '' });
});

test('scheduled checks reschedule when busy or when settings fail', async () =>
{
    const app = makeApp();
    let schedules = 0;
    app.checking = true;
    app.updateTimeout = () => { schedules++; };
    await app.checkForUpdates();
    app.homey.settings.get = () => { throw new Error('settings failed'); };
    await app.checkForUpdates();
    assert.equal(schedules, 2);
    assert.equal(app.errors[0][0], 'Scheduled update check failed');
});

test('manual check returns immediately and logs a later rejection', async () =>
{
    const app = makeApp();
    app.checkNow = async () => { throw new Error('manual check failed'); };
    await api.CheckNow({ homey: { app } });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(app.errors[0][0], 'Manual update check failed');
});
