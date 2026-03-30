// Centralized session helper
// Provides: getAuthToken, setAuthToken, clearAuth, getUserInfo, setUserInfo, getAuthHeaders, fetchWithAuth

(function(window){
    // Configuration - can be changed at runtime via setRefreshConfig
    let REFRESH_ENDPOINT = '/refresh_token'; // Assumed endpoint; can be overridden
    let REFRESH_METHOD = 'POST';
    let REFRESH_BODY_FIELD = 'refresh_token'; // field name expected by backend
    let RESPONSE_TOKEN_FIELD = 'token'; // field in refresh response containing new access token
    let RESPONSE_REFRESH_FIELD = 'refresh_token'; // optional field for new refresh token

    function getAuthToken() {
        return localStorage.getItem('auth_token');
    }

    function setAuthToken(token) {
        if (token) {
            localStorage.setItem('auth_token', token);
        }
    }

    function getRefreshToken() {
        return localStorage.getItem('refresh_token');
    }

    function setRefreshToken(token) {
        if (token) {
            localStorage.setItem('refresh_token', token);
        }
    }

    function clearAuth() {
        localStorage.removeItem('auth_token');
        localStorage.removeItem('refresh_token');
        localStorage.removeItem('user_info');
    }

    function getUserInfo() {
        try {
            return JSON.parse(localStorage.getItem('user_info') || 'null');
        } catch (e) {
            return null;
        }
    }

    function setUserInfo(user) {
        if (user) {
            localStorage.setItem('user_info', JSON.stringify(user));
        }
    }

    function getAuthHeaders() {
        const token = getAuthToken();
        const headers = { 'Content-Type': 'application/json' };
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }
        return headers;
    }

    // Refresh token single-flight promise so concurrent requests wait on the same refresh
    let refreshingPromise = null;

    function setRefreshConfig(cfg = {}) {
        if (cfg.endpoint) REFRESH_ENDPOINT = cfg.endpoint;
        if (cfg.method) REFRESH_METHOD = cfg.method;
        if (cfg.requestField) REFRESH_BODY_FIELD = cfg.requestField;
        if (cfg.responseTokenField) RESPONSE_TOKEN_FIELD = cfg.responseTokenField;
        if (cfg.responseRefreshField) RESPONSE_REFRESH_FIELD = cfg.responseRefreshField;
    }

    async function doRefresh() {
        // If there's already a refresh in progress, return that promise
        if (refreshingPromise) return refreshingPromise;

        const refreshToken = getRefreshToken();
        if (!refreshToken) {
            return Promise.reject(new Error('No refresh token available'));
        }

        // Build request body as JSON with configurable field name
        const body = {};
        body[REFRESH_BODY_FIELD] = refreshToken;

        refreshingPromise = fetch(REFRESH_ENDPOINT, {
            method: REFRESH_METHOD,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        }).then(async res => {
            if (!res.ok) {
                throw new Error('Refresh failed');
            }
            const data = await res.json();
            const newToken = data[RESPONSE_TOKEN_FIELD] || data.token || null;
            const newRefresh = data[RESPONSE_REFRESH_FIELD] || data.refresh_token || null;

            if (!newToken) {
                throw new Error('Refresh response did not include new token');
            }

            setAuthToken(newToken);
            if (newRefresh) setRefreshToken(newRefresh);
            if (data.user) setUserInfo(data.user);

            return newToken;
        }).finally(() => {
            // Reset the refreshingPromise so future refreshes can run
            refreshingPromise = null;
        });

        return refreshingPromise;
    }

    // Enhanced fetchWithAuth: attach headers, on 401 try to refresh token and retry once
    async function fetchWithAuth(url, options = {}) {
        const headers = getAuthHeaders();
        const mergedOptions = {
            ...options,
            headers: {
                ...headers,
                ...(options.headers || {})
            }
        };

        let response = await fetch(url, mergedOptions);

        if (response.status === 401) {
            // Try refresh flow if refresh token exists
            try {
                await doRefresh();
                // Retry original request with new token
                const retryHeaders = getAuthHeaders();
                const retryOptions = {
                    ...options,
                    headers: {
                        ...retryHeaders,
                        ...(options.headers || {})
                    }
                };
                response = await fetch(url, retryOptions);

                if (response.status === 401) {
                    // Still unauthorized after refresh - clear session and redirect
                    clearAuth();
                    window.location.href = '/';
                    return null;
                }

            } catch (err) {
                // Refresh failed - clear session and redirect
                clearAuth();
                window.location.href = '/';
                return null;
            }
        }

        return response;
    }

    // Expose on window for global access (non-module environment)
    window.getAuthToken = getAuthToken;
    window.setAuthToken = setAuthToken;
    window.getRefreshToken = getRefreshToken;
    window.setRefreshToken = setRefreshToken;
    window.clearAuth = clearAuth;
    window.getUserInfo = getUserInfo;
    window.setUserInfo = setUserInfo;
    window.getAuthHeaders = getAuthHeaders;
    window.fetchWithAuth = fetchWithAuth;
    window.setRefreshConfig = setRefreshConfig;
    window.doRefresh = doRefresh;

})(window);
