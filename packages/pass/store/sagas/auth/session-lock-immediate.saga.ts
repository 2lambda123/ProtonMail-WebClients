import { fork, put, takeLeading } from 'redux-saga/effects';

import { cacheRequest, sessionLockIntent } from '@proton/pass/store/actions';
import type { RootSagaOptions } from '@proton/pass/store/types';
import noop from '@proton/utils/noop';

/* If we the user has not registered a lock yet (ie: has
 * a sessionLockToken saved) then this saga should have
 * no effect */
function* lockSessionImmediateWorker({ getAuthService, getAuthStore: getAuth }: RootSagaOptions) {
    if (getAuth().getLockToken() !== undefined) {
        yield put(cacheRequest({ throttle: false }));

        yield fork(function* () {
            /* fork for non-blocking action -> immediate UI effect */
            yield getAuthService().lock({ soft: false }).catch(noop);
        });
    }
}

export default function* watcher(options: RootSagaOptions) {
    yield takeLeading(sessionLockIntent.match, lockSessionImmediateWorker, options);
}
