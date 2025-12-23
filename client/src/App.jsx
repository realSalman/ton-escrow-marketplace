import { useEffect, useState } from 'react';
import { useDispatch } from 'react-redux';
import { useMiniAppAuth } from './hooks/useMiniAppAuth';
import { selectUser, addUser } from './features/usersSlice';
import { HomePage } from './pages/HomePage';
import { ShopPage } from './pages/ShopPage';
import { ListingDetailsPage } from './pages/ListingDetailsPage';
import { ProfilePage } from './pages/ProfilePage';
import { CheckoutPage } from './pages/CheckoutPage';
import { ChatPage } from './pages/ChatPage';
import { WantedPage } from './pages/WantedPage';
import { AdminPanel } from './pages/AdminPanel';
import houseIcon from './images/house.png';
import shopIcon from './images/shop.png';
import wantedIcon from './images/heart.png';
import profileIcon from './images/profile.png';
import chatIcon from './images/chat.png';
import backIcon from './images/back.png';
import {
  subscribeToOrders,
  subscribeToProfile,
} from './services/firestoreService';

const PAGES = ['home', 'shop', 'wanted', 'profile'];

function App() {
  const { user, initializing, getTelegramUserId } = useMiniAppAuth();
  const dispatch = useDispatch();
  const [page, setPage] = useState('home');
  const [selectedListing, setSelectedListing] = useState(null);
  const [orders, setOrders] = useState([]);
  const [profile, setProfile] = useState(null);
  const [profileClickCount, setProfileClickCount] = useState(0);
  const [showNumpad, setShowNumpad] = useState(false);
  const [numpadCode, setNumpadCode] = useState('');

  // Get Telegram-based user ID (tg_${telegramId} format)
  const userId = user ? getTelegramUserId() : null;

  useEffect(() => {
    if (!userId) return undefined;
    const unsubOrders = subscribeToOrders(userId, setOrders);
    const unsubProfile = subscribeToProfile(userId, setProfile);
    return () => {
      unsubOrders?.();
      unsubProfile?.();
    };
  }, [userId]);


  function handleNavigateToDetails(listing) {
    setSelectedListing(listing);
    setPage('listing-details');
  }

  function handleBackFromDetails() {
    // Don't clear listing - just change page. This prevents "listing not found" flash
    // The listing will be cleared when navigating to a new listing or component unmounts
    setPage('shop');
  }

  function handleBuyNow(listing) {
    setSelectedListing(listing);
    setPage('checkout');
  }

  function handleBackFromCheckout() {
    // Don't clear listing - just change page. This prevents "listing not found" flash
    // The listing will be cleared when navigating to a new listing or component unmounts
    setPage('listing-details');
  }

  function handlePaymentComplete(orderId, amount) {
    // Handle payment completion - you can add logic here to save order, show success, etc.
    console.log('Payment completed:', { orderId, amount });
    alert(`Payment successful! Order ID: ${orderId}`);
    // Navigate back to listing details or shop
    setSelectedListing(null);
    setPage('shop');
  }

  function handleBackFromChat() {
    setPage('shop');
  }

  function handleContactSeller(sellerUser) {
    // Ensure seller user exists in Firestore (add if not exists)
    // This ensures the seller is available in the users collection
    dispatch(addUser({
      uid: sellerUser.uid,
      displayName: sellerUser.displayName,
      fullName: sellerUser.fullName,
      firstName: sellerUser.firstName,
      lastName: sellerUser.lastName,
      username: sellerUser.username,
      avatar: sellerUser.avatar,
      photoURL: sellerUser.photoURL,
    }));
    
    // Select the seller in Redux store
    dispatch(selectUser(sellerUser));
    // Navigate to chat page
    setPage('chat');
  }

  function handleProfileClick() {
    if (page === 'profile') {
      const newCount = profileClickCount + 1;
      setProfileClickCount(newCount);
      
      if (newCount >= 7) {
        setShowNumpad(true);
        setProfileClickCount(0); // Reset counter
      } else {
        // Reset counter after 3 seconds if not clicking fast enough
        setTimeout(() => {
          setProfileClickCount(0);
        }, 2000);
      }
    } else {
      setPage('profile');
      setProfileClickCount(0);
    }
  }

  function handleNumpadNumber(num) {
    const newCode = numpadCode + num;
    setNumpadCode(newCode);
    
    if (newCode.length === 6) {
      if (newCode === '244369') {
        setShowNumpad(false);
        setNumpadCode('');
        setPage('admin');
      } else {
        // Wrong code - reset
        setNumpadCode('');
        alert('Incorrect code');
      }
    }
  }

  function handleNumpadBackspace() {
    setNumpadCode(numpadCode.slice(0, -1));
  }

  function handleNumpadClose() {
    setShowNumpad(false);
    setNumpadCode('');
    setProfileClickCount(0);
  }

  if (initializing) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center text-xl p-4 text-center">
        <p>Preparing mini app…</p>
      </div>
    );
  }


  return (
    <div className="flex flex-col min-h-screen max-w-screen overflow-x-hidden bg-white">
      <header className="sticky top-0 z-100 bg-white border-b-2 border-black rounded-b-xl p-3 px-4 flex justify-between items-center shadow-sm">
        <h1 className="text-xl m-0 font-bold">Marketplace</h1>
        {page !== 'chat' && (
          <button 
            className="text-sm text-gray-600 hover:text-gray-900 transition-colors px-2 py-1 rounded hover:bg-gray-50"
            onClick={() => setPage('chat')}
          >
            <img src={chatIcon} alt="Chat" className="w-5 h-5 object-contain" />
          </button>
        )}
        {page === 'chat' && (
          <button 
            className="text-sm text-gray-600 hover:text-gray-900 transition-colors px-2 py-1  rounded hover:bg-gray-50"
            onClick={handleBackFromChat}
          >
            <img src={backIcon} alt="Back" className="w-5 h-5 object-contain" />
          </button>
        )}
      </header>

      <main className="flex-1 p-4 pb-20 overflow-y-auto">
        {page === 'home' && <HomePage userProfile={profile} />}
        {page === 'shop' && (
          <ShopPage
            onNavigateToDetails={handleNavigateToDetails}
          />
        )}
        {page === 'wanted' && (
          <WantedPage
            onNavigateToDetails={handleNavigateToDetails}
          />
        )}
        {page === 'listing-details' && (
          <ListingDetailsPage
            listing={selectedListing}
            onBack={handleBackFromDetails}
            onBuyNow={handleBuyNow}
            onContactSeller={handleContactSeller}
          />
        )}
        {page === 'checkout' && (
          <CheckoutPage
            listing={selectedListing}
            onBack={handleBackFromCheckout}
            onPaymentComplete={handlePaymentComplete}
          />
        )}
        {page === 'profile' && (
          <ProfilePage
            profile={profile}
          />
        )}
        {page === 'chat' && (
          <ChatPage
            onBack={handleBackFromChat}
          />
        )}
        {page === 'admin' && (
          <AdminPanel
            onBack={() => setPage('profile')}
          />
        )}
      </main>

      {page !== 'listing-details' && page !== 'checkout' && page !== 'admin' && (
        <nav className="fixed bottom-0 left-0 right-0 bg-white border-t-2 border-black rounded-t-xl flex justify-around items-center py-2 pb-[max(8px,env(safe-area-inset-bottom))] z-100 shadow-sm">
          {PAGES.map((item) => (
            <button
              key={item}
              className={`flex flex-col items-center justify-center gap-1 py-2 px-3 bg-transparent border-none cursor-pointer min-w-[60px] flex-1 transition-colors active:bg-black/5 ${
                page === item ? 'text-black' : ''
              }`}
              onClick={item === 'profile' ? handleProfileClick : () => setPage(item)}
            >
              <span className={`text-2xl leading-none flex items-center justify-center ${page === item ? 'scale-110' : ''}`}>
                {getNavIcon(item)}
              </span>
              <span className="text-[0.7rem] uppercase font-medium">{item}</span>
            </button>
          ))}
        </nav>
      )}

      {/* Numpad Modal */}
      {showNumpad && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-1000 p-4">
          <div className="bg-white rounded-2xl border-2 border-black p-6 max-w-sm w-full">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold">Enter Code</h2>
              <button
                onClick={handleNumpadClose}
                className="text-gray-600 hover:text-gray-900 text-2xl"
              >
                ×
              </button>
            </div>
            
            <div className="mb-6">
              <div className="bg-gray-100 rounded-lg p-4 text-center">
                <div className="flex justify-center gap-2 mb-2">
                  {[0, 1, 2, 3, 4, 5].map((i) => (
                    <div
                      key={i}
                      className={`w-3 h-3 rounded-full ${
                        i < numpadCode.length ? 'bg-black' : 'bg-gray-300'
                      }`}
                    />
                  ))}
                </div>
                <p className="text-sm text-gray-600">
                  {numpadCode.length === 0 ? 'Enter 6-digit code' : '●'.repeat(numpadCode.length)}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
                <button
                  key={num}
                  onClick={() => handleNumpadNumber(num.toString())}
                  className="bg-white border-2 border-black rounded-lg py-4 text-xl font-bold hover:bg-gray-50 active:bg-gray-100 transition-colors"
                >
                  {num}
                </button>
              ))}
              <button
                onClick={handleNumpadBackspace}
                className="bg-gray-100 border-2 border-gray-300 rounded-lg py-4 text-xl font-bold hover:bg-gray-200 active:bg-gray-300 transition-colors"
              >
                ⌫
              </button>
              <button
                onClick={() => handleNumpadNumber('0')}
                className="bg-white border-2 border-black rounded-lg py-4 text-xl font-bold hover:bg-gray-50 active:bg-gray-100 transition-colors"
              >
                0
              </button>
              <button
                onClick={handleNumpadClose}
                className="bg-gray-100 border-2 border-gray-300 rounded-lg py-4 text-sm font-bold hover:bg-gray-200 active:bg-gray-300 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function getNavIcon(page) {
  const icons = {
    home: <img src={houseIcon} alt="home" className="w-5 h-5 object-contain" />,
    shop: <img src={shopIcon} alt="shop" className="w-5 h-5 object-contain" />,
    wanted: <img src={wantedIcon} alt="wanted" className="w-5 h-5 object-contain" />,
    profile: <img src={profileIcon} alt="profile" className="w-5 h-5 object-contain" />,
  };
  return icons[page] || '•';
}

export default App;
