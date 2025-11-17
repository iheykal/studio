// Wallet API Service
// Handles deposits, withdrawals, and transaction history

const API_URL = import.meta.env.VITE_API_URL || import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001/api';

// Helper function to get auth token
const getAuthToken = () => {
    return localStorage.getItem('token');
};

// Helper function to make authenticated requests
const authenticatedFetch = async (url: string, options: RequestInit = {}) => {
    const token = getAuthToken();
    const headers = {
        'Content-Type': 'application/json',
        ...(token && { 'Authorization': `Bearer ${token}` }),
        ...options.headers
    };

    return fetch(url, {
        ...options,
        headers
    });
};

export const walletAPI = {
    // Deposit money
    deposit: async (amount: number, paymentReference?: string, paymentGateway?: string) => {
        try {
            const response = await authenticatedFetch(`${API_URL}/wallet/deposit`, {
                method: 'POST',
                body: JSON.stringify({ amount, paymentReference, paymentGateway })
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: `HTTP ${response.status}: ${response.statusText}` }));
                return errorData;
            }

            return await response.json();
        } catch (error) {
            console.error('Deposit error:', error);
            return { error: 'Network error. Please check your connection and ensure the server is running.' };
        }
    },

    // Request withdrawal
    withdraw: async (withdrawalData: {
        amount: number;
        withdrawalMethod: string;
        phoneNumber?: string;
        recipientName?: string;
        accountNumber?: string;
        bankName?: string;
    }) => {
        try {
            const response = await authenticatedFetch(`${API_URL}/wallet/withdraw`, {
                method: 'POST',
                body: JSON.stringify(withdrawalData)
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: `HTTP ${response.status}: ${response.statusText}` }));
                return errorData;
            }

            return await response.json();
        } catch (error) {
            console.error('Withdrawal error:', error);
            return { error: 'Network error. Please check your connection and ensure the server is running.' };
        }
    },

    // Get transaction history
    getTransactions: async (filters?: { type?: string; status?: string; limit?: number; skip?: number }) => {
        try {
            const queryParams = new URLSearchParams();
            if (filters?.type) queryParams.append('type', filters.type);
            if (filters?.status) queryParams.append('status', filters.status);
            if (filters?.limit) queryParams.append('limit', filters.limit.toString());
            if (filters?.skip) queryParams.append('skip', filters.skip.toString());

            const url = `${API_URL}/wallet/transactions${queryParams.toString() ? '?' + queryParams.toString() : ''}`;
            const response = await authenticatedFetch(url);

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: `HTTP ${response.status}: ${response.statusText}` }));
                return errorData;
            }

            return await response.json();
        } catch (error) {
            console.error('Get transactions error:', error);
            return { error: 'Failed to fetch transactions' };
        }
    }
};

