import { useState, useEffect, useRef } from 'react';
import { useMiniAppAuth } from '../hooks/useMiniAppAuth';
import { fetchUserProfile, toggleWantedItem, checkIfWanted, fetchShopItemById } from '../services/firestoreService';

export function ListingDetailsPage({
  listing,
  onBack,
  onBuyNow,
  onContactSeller,
}) {
  const { getTelegramUserId } = useMiniAppAuth();
  const [seller, setSeller] = useState(null);
  const [loadingSeller, setLoadingSeller] = useState(false);
  const [isWanted, setIsWanted] = useState(false);
  const [isTogglingWanted, setIsTogglingWanted] = useState(false);
  const [fullListing, setFullListing] = useState(listing);
  const [loadingListing, setLoadingListing] = useState(false);
  const isTogglingRef = useRef(false); // Ref to track toggle state without causing re-renders
  const [selectedMedia, setSelectedMedia] = useState(null); // For zoom/modal view

  // Fetch full listing data if we only have minimal data (thumbnail, title, price, wantCount)
  useEffect(() => {
    if (!listing?.id) {
      setFullListing(null);
      return;
    }
    
    // Check if we have minimal data (missing media or description indicates minimal data)
    const hasMinimalData = !listing.media && !listing.description;
    
    if (hasMinimalData) {
      setLoadingListing(true);
      fetchShopItemById(listing.id)
        .then((fullData) => {
          if (fullData) {
            setFullListing(fullData);
          } else {
            setFullListing(listing); // Fallback to minimal data
          }
          setLoadingListing(false);
        })
        .catch((error) => {
          console.error('Error fetching full listing data:', error);
          setFullListing(listing); // Fallback to minimal data on error
          setLoadingListing(false);
        });
    } else {
      // Already have full data
      setFullListing(listing);
      setLoadingListing(false);
    }
  }, [listing?.id, listing?.media, listing?.description]);

  // Separate useEffect for wanted status - only runs when fullListing.id changes
  useEffect(() => {
    if (!fullListing?.id) {
      setIsWanted(false);
      return;
    }
    
    // Skip if we're in the middle of a toggle operation
    if (isTogglingRef.current) {
      return;
    }
    
    const checkWantedStatus = async () => {
      // Double-check ref before proceeding
      if (isTogglingRef.current) {
        return;
      }
      
      const currentUserId = getTelegramUserId();
      if (currentUserId && fullListing.id) {
        try {
          const wanted = await checkIfWanted(fullListing.id, currentUserId);
          // Only update if we're not currently toggling (triple-check)
          if (!isTogglingRef.current) {
            setIsWanted(wanted);
          }
        } catch (error) {
          console.error('Error checking wanted status:', error);
        }
      }
    };
    
    checkWantedStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullListing?.id]); // Only depend on fullListing.id, not getTelegramUserId

  useEffect(() => {
    // Reset state when listing changes
    setSeller(null);
    setLoadingSeller(false);
    
    if (!fullListing) {
      return;
    }

    // 1:Check if seller info is already included in listing (denormalized)
    // This is the preferred method as it avoids an extra database fetch
    // Check if we have denormalized seller info (sellerName is the key indicator)
    if (fullListing.sellerName) {
      // Use denormalized data directly - sellerName already contains the computed name
      setSeller({
        fullName: fullListing.sellerName,
        username: fullListing.sellerUsername || '',
        avatar: fullListing.sellerAvatar || '',
      });
      setLoadingSeller(false);
      return;
    }
    
    // 2: Fallback - fetch seller profile from Firestore
    // This is for older listings that don't have denormalized seller info
    if (fullListing.sellerId) {
      setLoadingSeller(true);
      
      fetchUserProfile(fullListing.sellerId, 5000) // 5s timeout for details page
        .then((sellerData) => {
          if (sellerData) {
            // Normalize the seller data structure
            setSeller({
              fullName: sellerData.fullName || 
                       (sellerData.firstName && sellerData.lastName 
                         ? `${sellerData.firstName} ${sellerData.lastName}`.trim()
                         : sellerData.firstName) ||
                       sellerData.username || 
                       'Unknown Seller',
              username: sellerData.username || '',
              avatar: sellerData.avatar || sellerData.photo_url || '',
              firstName: sellerData.firstName || '',
              lastName: sellerData.lastName || '',
            });
          } else {
            // Seller profile not found, but we have sellerId
            setSeller({
              fullName: 'Unknown Seller',
              username: '',
              avatar: '',
            });
          }
          setLoadingSeller(false);
        })
        .catch((err) => {
          console.error('Failed to fetch seller profile:', err);
          // Even on error, show something if we have sellerId
          setSeller({
            fullName: fullListing.sellerId ? `User ${fullListing.sellerId.slice(0, 6)}` : 'Unknown Seller',
            username: '',
            avatar: '',
          });
          setLoadingSeller(false);
        });
    } else {
      // No sellerId at all - this shouldn't happen but handle gracefully
      setSeller(null);
      setLoadingSeller(false);
    }
  }, [fullListing?.sellerId, fullListing?.sellerName, fullListing?.sellerAvatar, fullListing?.sellerUsername, fullListing?.id, getTelegramUserId]);

  if (!fullListing && !loadingListing) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center text-xl p-4 text-center">
        <p>Listing not found</p>
      </div>
    );
  }

  if (loadingListing) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center text-xl p-4 text-center">
        <div className="flex flex-col items-center gap-2">
          <div className="w-8 h-8 border-2 border-gray-300 border-t-gray-900 rounded-full animate-spin"></div>
          <p className="text-sm text-gray-500 animate-pulse">Loading listing...</p>
        </div>
      </div>
    );
  }

  // Use fullListing for rendering (rename to avoid conflict with prop)
  const displayListing = fullListing;

  return (
    <section>
      <div className="pb-10 mb-10">
        <header className="mb-6">
          <button className="text-sm text-gray-600 hover:text-gray-900 transition-colors" type="button" onClick={onBack} aria-label="Back">
            ← Back
          </button>
        </header>

        <div className="mb-6">
          <div className="mb-4">
            <h3 className="text-2xl font-medium ml-3">{displayListing.title}</h3>
          </div>
          
          {/* Media Gallery - Photos and Video combined */}
          {((displayListing.media && displayListing.media.length > 0) || displayListing.video) && (
            <div className="flex gap-2 overflow-x-auto mb-4">
              {/* Photos */}
              {displayListing.media && displayListing.media.map((base64Data, index) => (
                <img 
                  key={`img-${index}`} 
                  className="w-20 h-20 object-cover rounded-lg cursor-pointer hover:opacity-90 transition-opacity" 
                  src={base64Data} 
                  alt={`${displayListing.title} - ${index + 1}`}
                  onClick={() => setSelectedMedia({ type: 'image', src: base64Data, index })}
                />
              ))}
              {/* Video thumbnail */}
              {displayListing.video && (
                <div 
                  className="w-20 h-20 rounded-lg cursor-pointer hover:opacity-90 transition-opacity relative overflow-hidden bg-gray-900 flex items-center justify-center"
                  onClick={() => setSelectedMedia({ type: 'video', src: displayListing.video })}
                >
                  <video 
                    className="w-full h-full object-cover" 
                    src={displayListing.video} 
                    muted 
                    preload="metadata"
                  />
                  <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                    <svg className="w-8 h-8 text-white" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  </div>
                </div>
              )}
            </div>
          )}
            <div className="text-lg font-medium text-gray-900 ml-3">{displayListing.price} USDT</div>
          
          <div className="mb-4">
            <p className="text-sm text-gray-600 mb-4 ml-3">{displayListing.description}</p>
          </div>

          {displayListing.wantCount > 0 && (
            <div className="flex justify-between items-center pt-4 border-t border-gray-200 flex-wrap gap-2 sm:flex-col sm:items-stretch">
              <span className="text-xs text-gray-500 ml-3">{displayListing.wantCount} wants</span>
            </div>
          )}

          <div className="mb-4 bg-gray-50 rounded-lg p-3">
                          {/* Wanted Button */}
                          <button
                onClick={async () => {
                  const currentUserId = getTelegramUserId();
                  if (!currentUserId) {
                    alert('Please sign in to add items to your wanted list.');
                    return;
                  }
                  
                  if (isTogglingWanted) return;
                  
                  // Set ref to prevent useEffect from overwriting our optimistic update
                  isTogglingRef.current = true;
                  
                  // Optimistic update - update UI immediately
                  const newWantedStatus = !isWanted;
                  setIsWanted(newWantedStatus);
                  setIsTogglingWanted(true);
                  
                  // Update local listing wantCount for immediate UI feedback
                  if (fullListing) {
                    fullListing.wantCount = newWantedStatus 
                      ? (fullListing.wantCount || 0) + 1 
                      : Math.max(0, (fullListing.wantCount || 0) - 1);
                    setFullListing({ ...fullListing }); // Trigger re-render
                  }
                  
                  try {
                    // Perform the actual database operation
                    await toggleWantedItem(fullListing.id, currentUserId);
                  } catch (error) {
                    console.error('Error toggling wanted status:', error);
                    // Revert optimistic update on error
                    setIsWanted(!newWantedStatus);
                    if (fullListing) {
                      fullListing.wantCount = !newWantedStatus 
                        ? (fullListing.wantCount || 0) + 1 
                        : Math.max(0, (fullListing.wantCount || 0) - 1);
                      setFullListing({ ...fullListing }); // Trigger re-render
                    }
                    alert('Failed to update wanted status. Please try again.');
                  } finally {
                    setIsTogglingWanted(false);
                    // Clear ref after database operation completes
                    // Use a longer delay to ensure database has propagated
                    setTimeout(() => {
                      isTogglingRef.current = false;
                    }, 500);
                  }
                }}
                disabled={isTogglingWanted}
                className={`w-full mt-3 px-4 py-2 rounded-lg font-medium text-sm transition-colors flex items-center justify-center gap-2 ${
                  isWanted
                    ? 'bg-red-100 text-red-700 hover:bg-red-200 border border-red-300'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-300'
                } ${isTogglingWanted ? 'opacity-75' : ''}`}
              >
                <svg 
                  className={`w-4 h-4 transition-all ${isWanted ? 'fill-current' : ''}`} 
                  fill={isWanted ? 'currentColor' : 'none'} 
                  stroke="currentColor" 
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                </svg>
                {isWanted ? 'Remove from Wanted' : 'Add to Wanted'}
              </button>
              
              {/* Buy Now Button */}
              {onBuyNow && (
                <button
                  onClick={() => {
                    const currentUserId = getTelegramUserId();

                    
                    // Don't allow buying your own listing
                    if (currentUserId === displayListing.sellerId?.toString()) {
                      alert('You cannot buy your own listing.');
                      return;
                    }
                    
                    onBuyNow(displayListing);
                  }}
                  className="w-full mt-3 bg-black text-white px-4 py-2 rounded-lg font-medium text-sm hover:opacity-90 transition-opacity active:opacity-70"
                >
                  Buy Now
                </button>
              )}
          </div>
          {/* Seller Information */}
          {displayListing?.sellerId && (
            <div className="mb-4 mt-7 bg-gray-50 rounded-lg p-3">
              <p className="text-xs text-gray-500 mb-2 uppercase tracking-wider">Listed by</p>
              {loadingSeller ? (
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-gray-200 animate-pulse"></div>
                  <div className="flex-1">
                    <div className="h-4 w-24 bg-gray-200 rounded animate-pulse mb-1"></div>
                    <div className="h-3 w-16 bg-gray-200 rounded animate-pulse"></div>
                  </div>
                </div>
              ) : seller ? (
                <div className="flex items-center gap-3">
                  {seller.avatar ? (
                    <img 
                      src={seller.avatar} 
                      alt={seller.fullName || seller.username || 'Seller'} 
                      className="w-10 h-10 rounded-full object-cover border border-gray-200"
                      onError={(e) => {
                        // Hide broken image
                        e.target.style.display = 'none';
                      }}
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-gray-300 flex items-center justify-center text-gray-600 text-xs font-medium">
                      {(seller.fullName || seller.username || '?').charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {seller.fullName || seller.username || seller.firstName || 'Unknown Seller'}
                    </p>
                    {seller.username && 
                     seller.username !== seller.fullName && 
                     seller.username !== (seller.firstName || '') && (
                      <p className="text-xs text-gray-500 truncate">@{seller.username}</p>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-gray-200"></div>
                  <p className="text-sm text-gray-500">Seller information unavailable</p>
                </div>
              )}
              
              {/* Contact Seller Button */}
              {onContactSeller && displayListing?.sellerId && (
                <button
                  onClick={() => {
                    const currentUserId = getTelegramUserId();
                    
                    // Don't allow contacting yourself
                    if (currentUserId === displayListing.sellerId?.toString()) {
                      alert('You cannot contact yourself.');
                      return;
                    }
                    
                    // Create seller user object for chat
                    const sellerUser = {
                      uid: displayListing.sellerId.toString(),
                      displayName: seller?.fullName || displayListing.sellerName || 'Seller',
                      fullName: seller?.fullName || displayListing.sellerName || 'Seller',
                      firstName: seller?.firstName || '',
                      lastName: seller?.lastName || '',
                      username: seller?.username || displayListing.sellerUsername || '',
                      email: '',
                      photoURL: seller?.avatar || displayListing.sellerAvatar || '',
                      avatar: seller?.avatar || displayListing.sellerAvatar || '',
                    };
                    
                    onContactSeller(sellerUser);
                  }}
                  className="w-full mt-3 bg-blue-600 text-white px-4 py-2 rounded-lg font-medium text-sm hover:bg-blue-700 transition-colors active:bg-blue-800 flex items-center justify-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                  Contact Seller
                </button>
              )}
              

            </div>
          )}
          
          
        </div>

      </div>

      {/* Media Zoom Modal */}
      {selectedMedia && (
        <div 
          className="fixed top-0 left-0 right-0 bottom-0 bg-black/90 flex items-center justify-center z-50 p-4 animate-fade-in"
          onClick={() => setSelectedMedia(null)}
        >
          <div className="relative max-w-7xl max-h-[90vh] w-full h-full flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
            {/* Close button */}
            <button
              className="absolute top-4 right-4 z-10 w-10 h-10 flex items-center justify-center text-white hover:bg-white/20 rounded-full transition-colors"
              onClick={() => setSelectedMedia(null)}
              aria-label="Close"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            {/* Previous/Next buttons for images */}
            {selectedMedia.type === 'image' && displayListing.media && displayListing.media.length > 1 && (
              <>
                {selectedMedia.index > 0 && (
                  <button
                    className="absolute left-4 top-1/2 -translate-y-1/2 z-10 w-10 h-10 flex items-center justify-center text-white hover:bg-white/20 rounded-full transition-colors"
                    onClick={(e) => {
                      e.stopPropagation();
                      const prevIndex = selectedMedia.index - 1;
                      setSelectedMedia({ type: 'image', src: displayListing.media[prevIndex], index: prevIndex });
                    }}
                    aria-label="Previous"
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                )}
                {selectedMedia.index < displayListing.media.length - 1 && (
                  <button
                    className="absolute right-4 top-1/2 -translate-y-1/2 z-10 w-10 h-10 flex items-center justify-center text-white hover:bg-white/20 rounded-full transition-colors"
                    onClick={(e) => {
                      e.stopPropagation();
                      const nextIndex = selectedMedia.index + 1;
                      setSelectedMedia({ type: 'image', src: displayListing.media[nextIndex], index: nextIndex });
                    }}
                    aria-label="Next"
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                )}
              </>
            )}

            {/* Media content */}
            <div className="w-full h-full flex items-center justify-center">
              {selectedMedia.type === 'image' ? (
                <img 
                  src={selectedMedia.src} 
                  alt={`${displayListing.title} - ${selectedMedia.index + 1}`}
                  className="max-w-full max-h-full object-contain"
                />
              ) : (
                <video 
                  className="max-w-full max-h-full"
                  src={selectedMedia.src} 
                  controls 
                  autoPlay
                  loop
                />
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

