import { createContext, useState, useEffect } from 'react';

export interface ShowDetails {
  id: string;
  name: string;
  max_episodes: number;
  ended: boolean;
  image: string;
}

export const FavoritesContext = createContext<{
  favorites: Record<string, ShowDetails>;
  toggleFavorite: (show: ShowDetails) => void;
} | null>(null);

export function FavoritesProvider({ children }: { children: React.ReactNode }) {
  const [favorites, setFavorites] = useState<Record<string, ShowDetails>>({});

  useEffect(() => {
    const stored = localStorage.getItem('asd');
    const saved: Record<string, ShowDetails> = stored ? JSON.parse(stored) : {};

    // allanime ids don't resolve on hianime, whose ids are slug-number.
    // the old entries are kept aside instead of being dropped silently.
    const kept = Object.fromEntries(
      Object.entries(saved).filter(([id]) => /-\d+$/.test(id))
    );

    if (Object.keys(kept).length !== Object.keys(saved).length) {
      localStorage.setItem('asd.allanime', JSON.stringify(saved));
      localStorage.setItem('asd', JSON.stringify(kept));
    }

    setFavorites(kept);
  }, []);

  const toggleFavorite = (show: ShowDetails) => {
    setFavorites((prev) => {
      const newFavorites = { ...prev };
      
      if (newFavorites[show.id]) {
        delete newFavorites[show.id];
      } else {
        newFavorites[show.id] = show;
      }
      
      localStorage.setItem('asd', JSON.stringify(newFavorites));
      return newFavorites;
    });
  };

  return (
    <FavoritesContext.Provider value={{ favorites, toggleFavorite }}>
      {children}
    </FavoritesContext.Provider>
  );
}