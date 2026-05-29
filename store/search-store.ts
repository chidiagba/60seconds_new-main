import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { searchService } from '@/lib/database';

// Search result types
export interface SearchResults {
  events: any[];
  videos: any[];
  users: any[];
  totalResults: number;
}

interface SearchState {
  searchQuery: string;
  searchHistory: string[];
  activeFilter: string;
  searchResults: SearchResults | null;
  isLoading: boolean;
  error: string | null;
  
  // Actions
  setSearchQuery: (query: string) => void;
  clearSearchQuery: () => void;
  addToSearchHistory: (query: string) => void;
  removeFromSearchHistory: (query: string) => void;
  clearSearchHistory: () => void;
  setActiveFilter: (filter: string) => void;
  performSearch: (query: string, filters?: any) => Promise<void>;
  clearSearchResults: () => void;
}

export const useSearchStore = create<SearchState>()(
  persist(
    (set, get) => ({
      searchQuery: '',
      searchHistory: [],
      activeFilter: 'all',
      searchResults: null,
      isLoading: false,
      error: null,
      
      setSearchQuery: (query: string) => set({ searchQuery: query }),
      
      clearSearchQuery: () => set({ searchQuery: '' }),
      
      addToSearchHistory: (query: string) => {
        if (!query.trim()) return;
        
        set(state => {
          // Remove if already exists (to move it to the top)
          const filteredHistory = state.searchHistory.filter(
            item => item.toLowerCase() !== query.toLowerCase()
          );
          
          // Add to the beginning of the array and limit to 10 items
          return { 
            searchHistory: [query, ...filteredHistory].slice(0, 10) 
          };
        });
      },
      
      removeFromSearchHistory: (query: string) => {
        set(state => ({
          searchHistory: state.searchHistory.filter(
            item => item.toLowerCase() !== query.toLowerCase()
          )
        }));
      },
      
      clearSearchHistory: () => set({ searchHistory: [] }),
      
      setActiveFilter: (filter: string) => set({ activeFilter: filter }),

      performSearch: async (query: string, filters?: any) => {
        if (!query.trim()) {
          set({ searchResults: null, error: null });
          return;
        }

        set({ isLoading: true, error: null });

        try {
          const results = await searchService.searchAll(query, filters);
          set({ 
            searchResults: results, 
            isLoading: false,
            error: null 
          });
        } catch (error) {
          console.error('Search error:', error);
          set({ 
            error: error instanceof Error ? error.message : 'Search failed',
            isLoading: false,
            searchResults: null
          });
        }
      },

      clearSearchResults: () => set({ 
        searchResults: null, 
        error: null 
      }),
    }),
    {
      name: 'search-storage',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ 
        searchHistory: state.searchHistory,
        // Don't persist the search query or active filter
      }),
    }
  )
);