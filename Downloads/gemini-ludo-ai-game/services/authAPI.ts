// Auth API Service
// This service provides authentication API calls
// Uses environment variables for API URL configuration

// Helper function to get the API URL, automatically detecting hostname for mobile devices
function getApiUrl(): string {
  // First, check if environment variable is explicitly set
  const envUrl = import.meta.env.VITE_API_URL || import.meta.env.VITE_BACKEND_URL;
  if (envUrl && envUrl !== 'http://localhost:3001/api' && !envUrl.startsWith('/')) {
    return envUrl;
  }
  
  // If we're in the browser, detect the hostname dynamically
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname;
    const port = '3001';
    
    // If accessing from IP address (not localhost), use that IP for API
    if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
      return `http://${hostname}:${port}/api`;
    }
  }
  
  // Default fallback
  return 'http://localhost:3001/api';
}

const API_URL_VALUE = getApiUrl();
const API_URL = API_URL_VALUE;

// Check if we should use real API or mock
// Default to true if API_URL is set to a real URL (not /api)
const USE_REAL_API = import.meta.env.VITE_USE_REAL_API === 'true' || 
                     import.meta.env.USE_REAL_API === 'true' ||
                     (API_URL_VALUE !== '/api' && !API_URL_VALUE.startsWith('/')) ||
                     import.meta.env.MODE === 'production';

// Log configuration for debugging
const currentHostname = typeof window !== 'undefined' ? window.location.hostname : 'N/A';
console.log('🔧 Auth API Configuration:', {
    API_URL: API_URL_VALUE,
    Current_Hostname: currentHostname,
    USE_REAL_API,
    MODE: import.meta.env.MODE,
    VITE_USE_REAL_API: import.meta.env.VITE_USE_REAL_API,
    USE_REAL_API_ENV: import.meta.env.USE_REAL_API
});

// Helper function to get auth header
const getAuthHeader = () => {
    const token = localStorage.getItem('token');
    return token ? { Authorization: `Bearer ${token}` } : {};
};

// Helper function to simulate API delay
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Mock user data for testing
const mockUsers: Array<{ username: string; phone: string; password: string; balance: number; _id: string }> = [
    { username: 'Test User', phone: '610251014', password: 'password123', balance: 1000, _id: 'user1' }
];

// Auth API
export const authAPI = {
    register: async (userData: { username: string; phone: string; password: string }) => {
        // Always use real API now that backend is set up
        try {
            const registerUrl = API_URL.endsWith('/auth/register') ? API_URL : `${API_URL}/auth/register`;
            console.log('API: Sending register request to:', registerUrl);
            
            const response = await fetch(registerUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(userData)
            });
            
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: `HTTP ${response.status}: ${response.statusText}` }));
                return errorData;
            }
            
            return await response.json();
        } catch (error) {
            console.error('Registration error:', error);
            return { error: 'Network error. Please check your connection and ensure the server is running on port 3001.' };
        }
    },
    
    login: async (credentials: { phone: string; password: string }) => {
        // Always use real API now that backend is set up
        try {
            const loginUrl = API_URL.endsWith('/auth/login') ? API_URL : `${API_URL}/auth/login`;
            console.log('API: Sending login request to:', loginUrl);
            console.log('API: Using real backend, credentials:', { phone: credentials.phone, hasPassword: !!credentials.password });
            
            const response = await fetch(loginUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(credentials)
            });
            
            console.log('API: Response status:', response.status);
            
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: `HTTP ${response.status}: ${response.statusText}` }));
                console.error('API: Login failed:', errorData);
                return errorData;
            }
            
            const data = await response.json();
            console.log('API: Response data:', data);
            
            return data;
        } catch (error) {
            console.error('API: Login error:', error);
            return { error: 'Network error. Please check your connection and ensure the server is running on port 3001.' };
        }
    },
    
    getProfile: async () => {
        if (USE_REAL_API) {
            try {
                const response = await fetch(`${API_URL}/auth/me`, {
                    headers: getAuthHeader()
                });
                return await response.json();
            } catch (error) {
                console.error('Get profile error:', error);
                return { error: 'Failed to load profile' };
            }
        }

        // Mock implementation
        await delay(300);
        const token = localStorage.getItem('token');
        if (!token) {
            return { error: 'Not authenticated' };
        }

        // In a real app, this would validate the token and fetch user data
        // For now, return a mock user
        const user = mockUsers[0];
        if (!user) {
            return { error: 'User not found' };
        }

        return {
            _id: user._id,
            username: user.username,
            phone: user.phone,
            balance: user.balance,
            isAdmin: false,
            isSuperAdmin: false
        };
    },
    
    getBalance: async () => {
        if (USE_REAL_API) {
            try {
                const response = await fetch(`${API_URL}/auth/balance`, {
                    headers: getAuthHeader()
                });
                return await response.json();
            } catch (error) {
                console.error('Get balance error:', error);
                return { error: 'Failed to load balance' };
            }
        }

        // Mock implementation
        await delay(300);
        const token = localStorage.getItem('token');
        if (!token) {
            return { error: 'Not authenticated' };
        }

        const user = mockUsers[0];
        return { balance: user?.balance || 0 };
    }
};

