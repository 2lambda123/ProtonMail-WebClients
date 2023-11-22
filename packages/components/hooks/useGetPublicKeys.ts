import { useCallback } from 'react';

import getPublicKeysEmailHelper from '@proton/shared/lib/api/helpers/getPublicKeysEmailHelper';
import { MINUTE } from '@proton/shared/lib/constants';
import { GetPublicKeys } from '@proton/shared/lib/interfaces/hooks/GetPublicKeys';

import { useKeyTransparencyContext } from '../containers/keyTransparency';
import useApi from './useApi';
import useCache from './useCache';
import { getPromiseValue } from './useCachedModelResult';

export const CACHE_KEY = 'PUBLIC_KEYS';

const DEFAULT_LIFETIME = 30 * MINUTE;

export const useGetPublicKeys = () => {
    const cache = useCache();
    const api = useApi();
    const { verifyOutboundPublicKeys, ktActivation } = useKeyTransparencyContext();
    return useCallback<GetPublicKeys>(
        ({ email, lifetime = DEFAULT_LIFETIME, noCache = false, internalKeysOnly }) => {
            if (!cache.has(CACHE_KEY)) {
                cache.set(CACHE_KEY, new Map());
            }
            const subCache = cache.get(CACHE_KEY);
            const miss = () =>
                getPublicKeysEmailHelper({
                    email,
                    internalKeysOnly,
                    api,
                    ktActivation,
                    verifyOutboundPublicKeys,
                    silence: true,
                    noCache,
                });
            return getPromiseValue(subCache, email, miss, lifetime);
        },
        [api, cache, ktActivation]
    );
};

export default useGetPublicKeys;