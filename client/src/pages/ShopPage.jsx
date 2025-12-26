import { useState, useRef, useEffect, useCallback } from 'react';
import { useMiniAppAuth } from '../hooks/useMiniAppAuth';
import { useTonConnect } from '../hooks/useTonConnect';
import { useTonConnectModal } from '@tonconnect/ui-react';
import { fetchShopItemsRealtime, createShopItemRealtime, uploadMediaFiles, fetchUserProfile } from '../services/firestoreService';

const MAX_PHOTOS = 9;
const MAX_VIDEO_DURATION = 15; // seconds

export function ShopPage({
  onNavigateToDetails,
}) {
  const { user, getTelegramUserId } = useMiniAppAuth();
  const userId = user ? getTelegramUserId() : null;
  const { walletAddress, connected, tonConnectUI } = useTonConnect();
  const { open } = useTonConnectModal();
  const [items, setItems] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [lastCreatedAt, setLastCreatedAt] = useState(null);
  const [form, setForm] = useState({
    title: '',
    price: '',
    description: '',
  });
  const [photos, setPhotos] = useState([]);
  const [video, setVideo] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const photoInputRef = useRef(null);
  const videoInputRef = useRef(null);

  const handleConnectWallet = useCallback(() => {
    open();
  }, [open]);

  const handleDisconnectWallet = useCallback(() => {
    if (tonConnectUI) {
      tonConnectUI.disconnect();
    }
  }, [tonConnectUI]);

  // Format wallet address in Tonkeeper style (first 6 and last 4 characters)
  // Uses user-friendly format (UQ prefix) like Tonkeeper
  const formatWalletAddress = useCallback((address) => {
    if (!address) return '';
    // Get user-friendly format (UQ prefix) like Tonkeeper uses
    const addressStr = address.toString({ bounceable: false });
    if (addressStr.length <= 10) return addressStr;
    // Show first 6 characters and last 4 characters, like Tonkeeper: "UQAbc1...xyz"
    return `${addressStr.slice(0, 6)}...${addressStr.slice(-4)}`;
  }, []);

  // Function to load initial items (can be called from useEffect or after creation)
  const loadInitialItems = useCallback(async () => {
    setIsLoading(true);
    setItems([]);
    setLastCreatedAt(null);
    setHasMore(true);
    
    try {
      // Request minimal data: only thumbnail, title, price, wantCount, id, createdAt
      const shopItems = await fetchShopItemsRealtime(searchTerm, 10, null, true);
      setItems(shopItems);
      
      if (shopItems.length > 0) {
        // Set the last item's createdAt for pagination
        const lastItem = shopItems[shopItems.length - 1];
        setLastCreatedAt(lastItem.createdAt);
        setHasMore(shopItems.length === 10); // If we got 10 items, there might be more
      } else {
        setHasMore(false);
      }
    } catch (error) {
      console.error('Error loading shop items:', error);
      alert('Failed to load items. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, [searchTerm]);

  // Fetch initial items when search term changes
  useEffect(() => {
    loadInitialItems();
  }, [loadInitialItems]);

  // Load more items function
  const loadMoreItems = useCallback(async () => {
    if (isLoadingMore || !hasMore || !lastCreatedAt) return;
    
    setIsLoadingMore(true);
    try {
      // Request minimal data: only thumbnail, title, price, wantCount, id, createdAt
      const newItems = await fetchShopItemsRealtime(searchTerm, 10, lastCreatedAt, true);
      
      if (newItems.length > 0) {
        setItems((prev) => [...prev, ...newItems]);
        const lastItem = newItems[newItems.length - 1];
        setLastCreatedAt(lastItem.createdAt);
        setHasMore(newItems.length === 10); // If we got 10 items, there might be more
      } else {
        setHasMore(false);
      }
    } catch (error) {
      console.error('Error loading more items:', error);
    } finally {
      setIsLoadingMore(false);
    }
  }, [isLoadingMore, hasMore, lastCreatedAt, searchTerm]);

  // Infinite scroll
  useEffect(() => {
    const handleScroll = () => {
      if (isLoading || isLoadingMore || !hasMore) return;
      
      const scrollTop = window.scrollY || document.documentElement.scrollTop;
      const scrollHeight = document.documentElement.scrollHeight;
      const clientHeight = window.innerHeight;
      
      // Load more when user is within 200px of bottom
      if (scrollHeight - scrollTop - clientHeight < 200) {
        loadMoreItems();
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    
    return () => {
      window.removeEventListener('scroll', handleScroll);
    };
  }, [isLoading, isLoadingMore, hasMore, loadMoreItems]);

  function handleInput(e) {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  function handlePhotos(e) {
    const selectedFiles = Array.from(e.target.files || []);
    const currentPhotoCount = photos.length;
    const totalCount = currentPhotoCount + selectedFiles.length;
    
    if (totalCount > MAX_PHOTOS) {
      alert(`You can only upload a maximum of ${MAX_PHOTOS} photos. You currently have ${currentPhotoCount} photo(s) and tried to add ${selectedFiles.length} more.`);
      // Reset the input
      if (photoInputRef.current) photoInputRef.current.value = '';
      return;
    }
    
    // Combine existing photos with new ones, but limit to MAX_PHOTOS
    const newPhotos = [...photos, ...selectedFiles].slice(0, MAX_PHOTOS);
    setPhotos(newPhotos);
  }

  function handleVideo(e) {
    const file = e.target.files?.[0];
    if (!file) {
      setVideo(null);
      return;
    }
    
    // Check file size
    if (file.size > 10 * 1024 * 1024) {
      alert('Video must be 10MB max (for database storage)');
      if (videoInputRef.current) videoInputRef.current.value = '';
      return;
    }
    
    // Check video duration
    const videoElement = document.createElement('video');
    videoElement.preload = 'metadata';
    
    videoElement.onloadedmetadata = () => {
      window.URL.revokeObjectURL(videoElement.src);
      const duration = videoElement.duration;
      
      if (duration > MAX_VIDEO_DURATION) {
        alert(`Video must be ${MAX_VIDEO_DURATION} seconds or less. Your video is ${duration.toFixed(1)} seconds long.`);
        if (videoInputRef.current) videoInputRef.current.value = '';
        setVideo(null);
      } else {
        setVideo(file);
      }
    };
    
    videoElement.onerror = () => {
      window.URL.revokeObjectURL(videoElement.src);
      alert('Error loading video. Please try a different file.');
      if (videoInputRef.current) videoInputRef.current.value = '';
      setVideo(null);
    };
    
    videoElement.src = URL.createObjectURL(file);
  }

  async function submitItem(e) {
    e.preventDefault();
    if (!userId) {
      alert('Please sign in with Telegram to create a listing.');
      return;
    }
    
    // Validate wallet connection
    if (!connected || !walletAddress) {
      alert('Please connect your wallet to create a listing.');
      return;
    }
    
    // Validate photo count
    if (photos.length > MAX_PHOTOS) {
      alert(`You can only upload a maximum of ${MAX_PHOTOS} photos.`);
      return;
    }
    
    // Validate video duration if video exists
    if (video) {
      try {
        const videoElement = document.createElement('video');
        videoElement.preload = 'metadata';
        
        const duration = await new Promise((resolve, reject) => {
          videoElement.onloadedmetadata = () => {
            window.URL.revokeObjectURL(videoElement.src);
            resolve(videoElement.duration);
          };
          videoElement.onerror = () => {
            window.URL.revokeObjectURL(videoElement.src);
            reject(new Error('Failed to load video metadata'));
          };
          videoElement.src = URL.createObjectURL(video);
        });
        
        if (duration > MAX_VIDEO_DURATION) {
          alert(`Video must be ${MAX_VIDEO_DURATION} seconds or less. Your video is ${duration.toFixed(1)} seconds long.`);
          return;
        }
      } catch (error) {
        console.error('Error validating video duration:', error);
        alert('Error validating video. Please try again.');
        return;
      }
    }
    
    // Verify authentication
    console.log('User authentication status:', {
      userId: userId,
      uid: user?.uid,
      email: user?.email,
      isAnonymous: user?.isAnonymous,
      providerData: user?.providerData,
    });
    
    setIsSubmitting(true);
    const startTime = Date.now();
    try {
      console.log('Starting item creation...', { userId: userId, form });
      
      // Convert photos and video to base64 (stored directly in database)
      let photoData = [];
      if (photos && photos.length > 0) {
        const photoStart = Date.now();
        console.log('Converting photos to base64...', photos.length);
        photoData = await uploadMediaFiles(userId, photos);
        console.log(`Photos converted in ${Date.now() - photoStart}ms`);
      }
      
      let videoData = null;
      if (video) {
        const videoStart = Date.now();
        console.log('Converting video to base64...');
        const videoArray = await uploadMediaFiles(userId, [video]);
        videoData = videoArray[0];
        console.log(`Video converted in ${Date.now() - videoStart}ms`);
      }
      
      // Get seller info - prefer Telegram profile (most reliable), fallback to Firestore
      let sellerInfo = null;
      const profileStart = Date.now();
      
      // Strategy 1: Try to get from Telegram profile directly (instant, no network call)
      const telegramProfile = window.Telegram?.WebApp?.initDataUnsafe?.user;
      if (telegramProfile) {
        const fullName = telegramProfile.first_name && telegramProfile.last_name
          ? `${telegramProfile.first_name} ${telegramProfile.last_name}`.trim()
          : telegramProfile.first_name || telegramProfile.username || 'User';
        
        sellerInfo = {
          fullName: fullName,
          firstName: telegramProfile.first_name || '',
          lastName: telegramProfile.last_name || '',
          username: telegramProfile.username || '',
          avatar: telegramProfile.photo_url || '',
        };
        console.log('Using Telegram profile directly:', sellerInfo);
      } else {
        // Strategy 2: Fallback to Firestore (may be slower or fail)
        console.log('Telegram profile not available, fetching from Firestore for userId:', userId);
        try {
          sellerInfo = await Promise.race([
            fetchUserProfile(userId, 5000),
            new Promise((resolve) => setTimeout(() => {
              console.warn('Seller profile fetch timed out after 5s');
              resolve(null);
            }, 5000)),
          ]);
          
          if (sellerInfo) {
            console.log(`Seller profile fetched from Firestore in ${Date.now() - profileStart}ms:`, {
              fullName: sellerInfo.fullName,
              firstName: sellerInfo.firstName,
              lastName: sellerInfo.lastName,
              username: sellerInfo.username,
              hasAvatar: !!sellerInfo.avatar,
            });
          } else {
            console.warn('No seller info available from Firestore');
          }
        } catch (err) {
          console.error('Error fetching seller profile from Firestore:', err);
        }
      }
      
      // Create shop item in Firebase Realtime Database
      // sellerInfo is optional - if null, only sellerId will be stored
      const dbWriteStart = Date.now();
      console.log('Creating shop item in Realtime DB...');
      const itemId = await createShopItemRealtime(userId, {
        ...form,
        price: Number(form.price),
        media: photoData, // base64 strings
        video: videoData, // base64 string
        walletAddress: walletAddress ? walletAddress.toString({ bounceable: false }) : null, // Store wallet address in user-friendly format (UQ)
      }, sellerInfo);
      const dbWriteTime = Date.now() - dbWriteStart;
      console.log(`Shop item created successfully in ${dbWriteTime}ms:`, itemId);
      console.log(`Total time: ${Date.now() - startTime}ms`);
      
      // Reset form after successful submission
      setForm({ title: '', price: '', description: '' });
      setPhotos([]);
      setVideo(null);
      // Reset file inputs
      if (photoInputRef.current) photoInputRef.current.value = '';
      if (videoInputRef.current) videoInputRef.current.value = '';
      // Close modal after successful submission
      setShowCreateModal(false);
      
      // Refresh items list to show the new listing
      // Small delay to ensure Realtime DB has propagated the write
      setTimeout(() => {
        loadInitialItems();
      }, 500);
    } catch (error) {
      console.error('Error creating listing:', error);
      console.error('Error details:', {
        message: error.message,
        code: error.code,
        stack: error.stack,
      });
      alert(`Failed to create listing: ${error.message || 'Please check console for details.'}`);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section>
      <div>
        <div className="flex gap-2 mb-6 sm:flex-col animate-fade-in">
          <input
            className="flex-1 min-w-[200px] border-b border-gray-300 bg-transparent p-2 text-sm focus:outline-none focus:border-gray-900 sm:w-full transition-all duration-300 focus:border-gray-900"
            placeholder="Search..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          {searchTerm && (
            <button className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 transition-all duration-200 hover:scale-105 sm:w-full sm:text-left animate-fade-in" type="button" onClick={() => setSearchTerm('')} aria-label="Clear search">
              Clear
            </button>
          )}
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12 animate-fade-in">
            <div className="flex flex-col items-center gap-2">
              <div className="w-8 h-8 border-2 border-gray-300 border-t-gray-900 rounded-full animate-spin"></div>
              <p className="text-sm text-gray-500 animate-pulse">Loading items...</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 mb-6 sm:grid-cols-1">
            {items.length === 0 ? (
              <p className="col-span-2 text-sm text-gray-500 text-center py-8 sm:col-span-1 animate-fade-in">No items found</p>
            ) : (
              items.map((item, index) => {
            const thumbnail = item.thumbnail; // Minimal data only includes thumbnail
            const wantCount = item.wantCount || 0;
            
            return (
              <article
                key={item.id}
                className="flex flex-col cursor-pointer group animate-fade-in-up"
                style={{ animationDelay: `${index * 50}ms` }}
                onClick={() => onNavigateToDetails && onNavigateToDetails(item)}
              >
                {/* Product Image */}
                <div className="w-full aspect-square overflow-hidden bg-gray-50 mb-2 rounded-xl transition-transform duration-300 group-hover:scale-[1.02]">
                  {thumbnail ? (
                    <img className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-110" src={thumbnail} alt={item.title} />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs">No Image</div>
                  )}
                </div>
                {/* Product Info */}
                <div className="flex flex-col gap-1">
                  <h3 className="text-sm font-semibold leading-tight line-clamp-2 text-gray-900 group-hover:text-gray-600 transition-colors duration-200">{item.title}</h3>
                  <div className="flex justify-between items-center text-xs text-gray-500">
                    <span className="transition-transform duration-200 group-hover:scale-105">{item.price} USDT</span>
                    {wantCount > 0 && <span className="transition-opacity duration-200 group-hover:opacity-80">{wantCount} wants</span>}
                  </div>
                </div>
              </article>
            );
              })
            )}
            {isLoadingMore && (
              <div className="col-span-2 text-sm text-gray-500 text-center py-4 sm:col-span-1 animate-fade-in">
                <div className="flex items-center justify-center gap-2">
                  <div className="w-4 h-4 border-2 border-gray-300 border-t-gray-900 rounded-full animate-spin"></div>
                  <span>Loading more items...</span>
                </div>
              </div>
            )}
            {!hasMore && items.length > 0 && (
              <div className="col-span-2 text-sm text-gray-500 text-center py-4 sm:col-span-1 animate-fade-in">
                No more items to load
              </div>
            )}
          </div>
        )}

      </div>

      {/* Floating Plus Button */}
      <button
        className="fixed bottom-20 left-1/2 -translate-x-1/2 w-12 h-12 rounded-full bg-gray-900 text-white flex items-center justify-center cursor-pointer z-99 shadow-md hover:shadow-lg transition-all duration-300 hover:bg-gray-800 hover:scale-110 active:scale-95 sm:bottom-20 animate-bounce-in group"
        type="button"
        onClick={() => setShowCreateModal(true)}
        aria-label="Create listing"
      >
        <span className="text-2xl leading-none font-light mb-1 transition-transform duration-300 group-hover:rotate-90">+</span>
      </button>

      {/* Create Listing Modal */}
      {showCreateModal && (
        <div className="fixed top-0 left-0 right-0 bottom-0 bg-black/40 flex items-center justify-center z-1000 p-4 overflow-y-auto animate-fade-in" onClick={() => setShowCreateModal(false)}>
          <div className="bg-white max-w-[600px] w-full max-h-[90vh] rounded-xl overflow-y-auto p-6 relative sm:max-h-[95vh] sm:p-4 animate-modal-slide-in" onClick={(e) => e.stopPropagation()}>
            <header className="flex justify-between items-start mb-6">
              <div>
                <h2 className="text-xl font-medium">Create listing</h2>
              </div>
              <button
                className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-900 transition-colors"
                type="button"
                onClick={() => setShowCreateModal(false)}
                aria-label="Close"
              >
                ✕
              </button>
            </header>
            <form className="flex flex-col gap-4" onSubmit={submitItem}>
              <label className="flex flex-col gap-1">
                <span className="text-sm text-gray-600">Title</span>
                <input className="border-b border-gray-300 bg-transparent p-2 text-sm focus:outline-none focus:border-gray-900" name="title" value={form.title} onChange={handleInput} required />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-sm text-gray-600">Price (USDT)</span>
                <input
                  className="border-b border-gray-300 bg-transparent p-2 text-sm focus:outline-none focus:border-gray-900"
                  name="price"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.price}
                  onChange={handleInput}
                  required
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-sm text-gray-600">Description</span>
                <textarea
                  className="border-b border-gray-300 bg-transparent p-2 text-sm min-h-[80px] resize-y focus:outline-none focus:border-gray-900"
                  name="description"
                  rows="3"
                  value={form.description}
                  onChange={handleInput}
                  required
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-sm text-gray-600">Photos (≤9)</span>
                <input className="text-sm py-2" ref={photoInputRef} type="file" accept="image/*" multiple onChange={handlePhotos} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-sm text-gray-600">Video (≤15s)</span>
                <input className="text-sm py-2" ref={videoInputRef} type="file" accept="video/*" onChange={handleVideo} />
              </label>
              <div className="flex flex-col gap-2">
                <label className="flex flex-col gap-1">
                  <span className="text-sm text-gray-600">Wallet Address <span className="text-red-500">*</span></span>
                  {connected && walletAddress ? (
                    <div className="flex items-center gap-2 p-2 border-b border-gray-300">
                      <span className="text-sm text-gray-700 flex-1 font-mono" title={walletAddress.toString({ bounceable: false })}>
                        {formatWalletAddress(walletAddress)}
                      </span>
                      <span className="text-xs text-green-600">Connected</span>
                      <button
                        type="button"
                        onClick={handleDisconnectWallet}
                        className="text-xs text-gray-500 hover:text-gray-900 px-2 py-1 border border-gray-300 rounded hover:bg-gray-50 transition-all duration-200"
                        title="Disconnect Wallet"
                      >
                        Disconnect
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={handleConnectWallet}
                      className="px-4 py-2 border border-red-300 rounded-xl text-sm hover:bg-red-50 transition-all duration-200 hover:scale-105 active:scale-95 text-left text-red-700"
                    >
                      Connect Wallet (Required)
                    </button>
                  )}
                </label>
              </div>
              <button type="submit" className="mt-2 px-4 py-2 bg-gray-900 text-white rounded-xl text-sm hover:bg-gray-800 transition-all duration-200 hover:scale-105 active:scale-95 disabled:opacity-50 disabled:hover:scale-100 disabled:cursor-not-allowed" disabled={isSubmitting || !connected || !walletAddress}>
                {isSubmitting ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                    Publishing...
                  </span>
                ) : 'Publish listing'}
              </button>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}

