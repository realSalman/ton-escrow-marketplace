import { useState, useEffect, useCallback } from 'react';
import { useMiniAppAuth } from '../hooks/useMiniAppAuth';
import { fetchWantedItems } from '../services/firestoreService';

export function WantedPage({
  onNavigateToDetails,
}) {
  const { user, getTelegramUserId } = useMiniAppAuth();
  const userId = user ? getTelegramUserId() : null;
  const [items, setItems] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  // Function to load wanted items
  const loadWantedItems = useCallback(async () => {
    if (!userId) {
      setIsLoading(false);
      setItems([]);
      return;
    }

    setIsLoading(true);
    try {
      const wantedItems = await fetchWantedItems(userId);
      setItems(wantedItems);
    } catch (error) {
      console.error('Error loading wanted items:', error);
      alert('Failed to load wanted items. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  // Load wanted items when user changes
  useEffect(() => {
    loadWantedItems();
  }, [loadWantedItems]);

  if (!userId) {
    return (
      <section>
        <div className="flex items-center justify-center py-12 animate-fade-in">
          <p className="text-sm text-gray-500">Please sign in to view your wanted items.</p>
        </div>
      </section>
    );
  }

  return (
    <section>
      <div>
        <header className="mb-6 animate-fade-in">
          <h2 className="text-2xl font-medium mb-2">Wanted Items</h2>
        </header>

        {isLoading ? (
          <div className="flex items-center justify-center py-12 animate-fade-in">
            <div className="flex flex-col items-center gap-2">
              <div className="w-8 h-8 border-2 border-gray-300 border-t-gray-900 rounded-full animate-spin"></div>
              <p className="text-sm text-gray-500 animate-pulse">Loading wanted items...</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 mb-6 sm:grid-cols-1">
            {items.length === 0 ? (
              <p className="col-span-2 text-sm text-gray-500 text-center py-8 sm:col-span-1 animate-fade-in">
                No wanted items yet. Add items to your wanted list from the shop!
              </p>
            ) : (
              items.map((item, index) => {
                const firstImage = item.media && item.media.length > 0 ? item.media[0] : null;
                const hasVideo = !!item.video;
                
                return (
                  <article
                    key={item.id}
                    className="flex flex-col cursor-pointer group animate-fade-in-up"
                    style={{ animationDelay: `${index * 50}ms` }}
                    onClick={() => onNavigateToDetails && onNavigateToDetails(item)}
                  >
                    {/* Product Image */}
                    <div className="w-full aspect-square overflow-hidden bg-gray-50 mb-2 rounded-xl transition-transform duration-300 group-hover:scale-[1.02]">
                      {hasVideo ? (
                        <video className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-110" src={item.video} muted preload="metadata" />
                      ) : firstImage ? (
                        <img className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-110" src={firstImage} alt={item.title} />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs">No Image</div>
                      )}
                    </div>
                    {/* Product Info */}
                    <div className="flex flex-col gap-1">
                      <h3 className="text-sm font-semibold leading-tight line-clamp-2 text-gray-900 group-hover:text-gray-600 transition-colors duration-200">{item.title}</h3>
                      <div className="flex justify-between items-center text-xs text-gray-500">
                        <span className="transition-transform duration-200 group-hover:scale-105">{item.price} USDT</span>
                      </div>
                    </div>
                  </article>
                );
              })
            )}
          </div>
        )}
      </div>
    </section>
  );
}

