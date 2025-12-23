import React, { useMemo, useEffect } from "react";
import { useSelector, useDispatch } from "react-redux";
import { fetchUserChats } from "../../features/chatsSlice";
import { ref, onValue, off } from "firebase/database";
import { realtimeDb } from "../../firebase/client";

import Chats from "./Chats";

export default function ChatContainer({ currentUser, selectedUser, onBack }) {
  const { chats, status, error } = useSelector((state) => state.chats);
  const dispatch = useDispatch();
  
  // Debug: Log chats state
  useEffect(() => {
    console.log('ChatsContainer: Chats state updated:', {
      chatsCount: chats.length,
      status,
      error,
      chats: chats.map(c => ({ id: c.id, type: c.type, membersCount: c.membersArray?.length || 0, messagesCount: c.messages?.length || 0 }))
    });
  }, [chats, status, error]);

  // ✅ Find the chat between these two users (if it exists)
  // Simplified to match working chat-app pattern
  const chatData = useMemo(() => {
    if (!currentUser?.uid || !selectedUser?.uid) {
      console.log('ChatsContainer: Missing currentUser or selectedUser', { 
        hasCurrentUser: !!currentUser?.uid, 
        hasSelectedUser: !!selectedUser?.uid 
      });
      return null;
    }
    
    // If chats haven't loaded yet, return null (will retry when chats load)
    if (status === "Pending..." && chats.length === 0) {
      console.log('ChatsContainer: Chats still loading, waiting...');
      return null;
    }
    
    // Convert UIDs to strings for consistent comparison
    const currentUid = currentUser.uid.toString();
    const selectedUid = selectedUser.uid.toString();
    
    console.log('ChatsContainer: Looking for chat between', currentUid, 'and', selectedUid, 'in', chats.length, 'chats');
    
    // First look for private chat - use simple array check like chat-app
    const privateChat = chats.find((chat) => {
      if (!chat || chat.type !== "direct") return false;
      
      // Prefer membersArray (always set when creating chats)
      const membersArray = chat.membersArray || [];
      
      // Fallback: if membersArray doesn't exist, try to get from members object
      const membersList = membersArray.length > 0 
        ? membersArray.map(m => m.toString()) // Ensure all are strings
        : (chat.members ? Object.keys(chat.members).map(k => k.toString()) : []);
      
      // Simple check like chat-app: members.includes(uid)
      const hasCurrent = membersList.includes(currentUid);
      const hasSelected = membersList.includes(selectedUid);
      
      if (hasCurrent && hasSelected) {
        console.log('Found matching chat:', chat.id, 'members:', membersList, 'messages:', chat.messages?.length || 0);
        return true;
      }
      
      return false;
    });

    // If not found, look for group chat by groupName
    const groupChat = chats.find((chat) => {
      if (!chat || chat.type !== "group") return false;
      const displayName = selectedUser?.displayName || selectedUser?.fullName || '';
      return chat.groupName?.includes(displayName);
    });

    const result = privateChat || groupChat || null;
    if (!result) {
      console.log('No chat found. Current chats:', chats.length, 'Current UID:', currentUid, 'Selected UID:', selectedUid);
      if (chats.length > 0) {
        console.log('Available chats:', chats.map(c => ({ id: c.id, type: c.type, members: c.membersArray || Object.keys(c.members || {}) })));
      }
    }
    
    return result;
  }, [chats, currentUser?.uid, selectedUser?.uid, selectedUser?.displayName, selectedUser?.fullName, status]);

  // Set up real-time listener for chats instead of polling
  useEffect(() => {
    if (!currentUser?.uid) return;
    
    // Initial fetch - this loads all chats with messages
    console.log('ChatsContainer: Fetching chats for user:', currentUser.uid);
    dispatch(fetchUserChats(currentUser.uid));
    
    // Set up real-time listener for chats - this will trigger when ANY chat changes
    const chatsRef = ref(realtimeDb, "chats");
    
    const unsubscribe = onValue(
      chatsRef,
      (snapshot) => {
        if (snapshot.exists()) {
          // Refetch user chats when any chat changes
          // This ensures we get the filtered list of chats the user is a member of
          // This will also reload messages for all chats
          console.log('ChatsContainer: Chat changed in database, refetching chats to get latest messages');
          dispatch(fetchUserChats(currentUser.uid))
            .then((result) => {
              console.log('ChatsContainer: Chats refetched successfully, result:', result);
            })
            .catch((err) => {
              console.error('ChatsContainer: Error refetching chats:', err);
            });
        }
      },
      (error) => {
        console.error('ChatsContainer: Error listening to chats:', error);
      }
    );

    return () => {
      console.log('ChatsContainer: Cleaning up chats listener');
      off(chatsRef);
    };
  }, [currentUser?.uid, dispatch]);
  
  // Also set up a listener specifically for messages in the current chat
  // This ensures the receiver sees new messages immediately
  useEffect(() => {
    if (!chatData?.id || !currentUser?.uid) return;
    
    console.log('ChatsContainer: Setting up message change listener for chat:', chatData.id);
    const messagesRef = ref(realtimeDb, `chats/${chatData.id}/messages`);
    
    const unsubscribe = onValue(
      messagesRef,
      (snapshot) => {
        if (snapshot.exists()) {
          // When messages change, refetch chats to update chatData with latest messages
          console.log('ChatsContainer: Messages changed in chat', chatData.id, ', refetching chats');
          dispatch(fetchUserChats(currentUser.uid));
        }
      },
      (error) => {
        console.error('ChatsContainer: Error listening to messages:', error);
      }
    );
    
    return () => {
      console.log('ChatsContainer: Cleaning up message listener for chat:', chatData.id);
      off(messagesRef);
    };
  }, [chatData?.id, currentUser?.uid, dispatch]);

  // ✅ Decide what to render:
  if (!selectedUser?.uid || !currentUser?.uid) {
    return (
      <div className="flex-1 flex flex-col justify-center items-center border rounded-lg bg-zinc-100">
        <span>Select chat to start chatting</span>
      </div>
    );
  }

  // Debug info (remove in production)
  if (process.env.NODE_ENV === 'development') {
    console.log('ChatsContainer render:', {
      chatsCount: chats.length,
      status,
      error,
      currentUserUid: currentUser?.uid,
      selectedUserUid: selectedUser?.uid,
      chatData: chatData ? { id: chatData.id, messagesCount: chatData.messages?.length || 0 } : null
    });
  }

  return (
    <>
      {error}
      {status === "Pending..."}
      <Chats
        currentUser={currentUser}
        selectedUser={selectedUser}
        chatData={chatData} // ✅ Pass chat object only if it exists
        onBack={onBack}
      />
    </>
  );
}

