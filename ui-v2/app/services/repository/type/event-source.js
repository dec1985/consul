import { inject as service } from '@ember/service';
import { get } from '@ember/object';

import LazyProxyService from 'consul-ui/services/lazy-proxy';

import { cache as createCache, BlockingEventSource } from 'consul-ui/utils/dom/event-source';

const createProxy = function(repo, find, settings, cache, serialize = JSON.stringify) {
  // proxied find*..(id, dc)
  const throttle = get(this, 'wait').execute;
  return function() {
    const key = `${repo.getModelName()}.${find}.${serialize([...arguments])}`;
    const _args = arguments;
    const newPromisedEventSource = cache;
    return newPromisedEventSource(
      function(configuration) {
        // take a copy of the original arguments
        // this means we don't have any configuration object on it
        let args = [..._args];
        if (settings.blocking) {
          // ...and only add our current cursor/configuration if we are blocking
          args = args.concat([configuration]);
        }
        // save a callback so we can conditionally throttle
        const cb = () => {
          // original find... with configuration now added
          return repo[find](...args)
            .then(res => {
              if (!settings.blocking) {
                // blocking isn't enabled, immediately close
                this.close();
              }
              return res;
            })
            .catch(function(e) {
              // setup the aborted connection restarting
              // this should happen here to avoid cache deletion
              const status = get(e, 'errors.firstObject.status');
              if (status === '0') {
                // Any '0' errors (abort) should possibly try again, depending upon the circumstances
              }
              throw e;
            });
        };
        // if we have a cursor (which means its at least the second call)
        // and we have a throttle setting, wait for so many ms
        if (configuration.cursor !== 'undefined' && settings.throttle) {
          return throttle(settings.throttle).then(cb);
        }
        return cb();
      },
      {
        key: key,
        type: BlockingEventSource,
      }
    );
  };
};
let cache = null;
export default LazyProxyService.extend({
  store: service('store'),
  settings: service('settings'),
  wait: service('timeout'),
  init: function() {
    this._super(...arguments);
    if (cache === null) {
      cache = createCache({});
    }
  },
  willDestroy: function() {
    cache = null;
  },
  shouldProxy: function(content, method) {
    return method.indexOf('find') === 0;
  },
  execute: function(repo, find) {
    return get(this, 'settings')
      .findBySlug('client')
      .then(settings => {
        return createProxy.bind(this)(repo, find, settings, cache);
      });
  },
});