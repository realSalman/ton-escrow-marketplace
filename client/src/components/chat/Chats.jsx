import React, { useMemo, useState, useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";

import { createChat, deleteMessage, sendMessage, updateMessage, fetchUserChats } from "../../features/chatsSlice";
import { ref, onValue, off } from "firebase/database";
import { realtimeDb } from "../../firebase/client";

import { RiPencilFill } from "react-icons/ri";
import { MdDelete } from "react-icons/md";
import { IoPaperPlane, IoArrowBackSharp } from "react-icons/io5";
import Message from "./Message";

function Chats({ currentUser, selectedUser, chatData, onBack }) {
  const dispatch = useDispatch();
  const [msg, setMsg] = useState({});
  const [text, setText] = useState("");
  const [isUpdating, setIsUpdating] = useState(false);
  const [messages, setMessages] = useState([]);

  const handleClick = async () => {
    if (!text.trim()) return; // avoid sending empty messages
    if (!currentUser?.uid || !selectedUser?.uid) return; // ensure users are set

    const messageText = text;
    setText(""); // Clear input immediately for better UX

    if (chatData) {
      if (isUpdating) {
        dispatch(updateMessage({ chatId: chatData.id, messageId: msg.id, newText: messageText }));
        setIsUpdating(false);
      } else {
        dispatch(sendMessage({ 
          chatId: chatData.id, 
          senderId: currentUser.uid, 
          message: messageText,
          receiverId: selectedUser.uid,
          receiverName: selectedUser.displayName || selectedUser.fullName || selectedUser.username || null,
          receiverPhotoURL: selectedUser.photoURL || selectedUser.avatar || null,
        }));
      }
    } else {
      try {
        // Ensure UIDs are strings for consistency
        const currentUid = currentUser.uid.toString();
        const selectedUid = selectedUser.uid.toString();
        
        // Create chat first
        const newChat = await dispatch(createChat({
          type: "direct",
          members: [currentUid, selectedUid]
        })).unwrap();
        
        console.log('Chat created:', newChat.id, 'with members:', [currentUid, selectedUid]);
        
        // Immediately send the message - don't wait for refetch
        // The message listener will pick it up once chatData is updated
        dispatch(sendMessage({ 
          chatId: newChat.id, 
          senderId: currentUid, 
          message: messageText,
          receiverId: selectedUser.uid,
          receiverName: selectedUser.displayName || selectedUser.fullName || selectedUser.username || null,
          receiverPhotoURL: selectedUser.photoURL || selectedUser.avatar || null,
        }));
        
        // Refetch chats in background to update chatData - this will trigger the listener setup
        dispatch(fetchUserChats(currentUid)).then(() => {
          console.log('Chats refetched after creation');
        }).catch((err) => {
          console.error('Error refetching chats:', err);
        });
      } catch (error) {
        console.error('Error creating chat:', error);
        const errorMessage = error?.message || error || 'Failed to create chat. Please try again.';
        alert(`Failed to create chat: ${errorMessage}`);
        setText(messageText); // Restore message text on error
      }
    }
  };

  const sortedMessages = useMemo(() => {
    return [...(messages || [])].sort((a, b) => {
      // Realtime DB uses timestamps (numbers), not Firestore timestamps
      const aTime = a.createdAt || 0;
      const bTime = b.createdAt || 0;
      return aTime - bTime;
    });
  }, [messages]);

  useEffect(() => {
    // Reset state when switching users/chats
    setText("");
    setIsUpdating(false);
    setMsg({});

    if (!chatData?.id) {
      // If no chat exists yet, we can't set up a listener
      // The listener will be set up once the chat is created
      console.log('Chats: No chatData.id, clearing messages');
      setMessages([]);
      return;
    }

    console.log('Chats: Setting up Realtime DB message listener for chat:', chatData.id, 'Initial messages:', chatData.messages?.length || 0);
    const messagesRef = ref(realtimeDb, `chats/${chatData.id}/messages`);

    let isMounted = true;

    // Initial load: Use messages from chatData if available (from Redux/fetchUserChats)
    // This ensures messages are shown immediately on page load/refresh
    // Also set empty array if no messages to ensure we start fresh
    if (chatData?.messages) {
      if (chatData.messages.length > 0) {
        console.log('Loading initial messages from chatData:', chatData.messages.length, 'for chat:', chatData.id);
        // Sort messages by createdAt
        const sortedMessages = [...chatData.messages].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
        setMessages(sortedMessages);
      } else {
        console.log('No initial messages in chatData for chat:', chatData.id);
        setMessages([]);
      }
    } else {
      console.log('No messages property in chatData for chat:', chatData.id);
      setMessages([]);
    }

    const unsubscribe = onValue(
      messagesRef, 
      (snapshot) => {
        if (!isMounted) return;
        
        if (snapshot.exists()) {
          const messagesData = snapshot.val();
          const msgs = Object.entries(messagesData || {}).map(([msgId, msgData]) => ({
            id: msgId,
            ...msgData
          }));
          // Sort messages by createdAt
          msgs.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
          console.log('Realtime DB message snapshot received:', msgs.length, 'messages for chat:', chatData.id);
          // Always update from real-time listener (this is the source of truth)
          setMessages(msgs);
        } else {
          console.log('No messages found in Realtime DB for chat:', chatData.id);
          setMessages([]);
        }
      },
      (error) => {
        console.error('Error listening to messages in Realtime DB for chat:', chatData.id, error);
        if (isMounted) {
          // On error, try to use messages from chatData as fallback
          if (chatData?.messages && chatData.messages.length > 0) {
            console.log('Using fallback messages from chatData due to listener error');
            setMessages(chatData.messages);
          } else {
            setMessages([]);
          }
        }
      }
    );

    return () => {
      isMounted = false;
      console.log('Cleaning up Realtime DB message listener for chat:', chatData.id);
      off(messagesRef);
    };
  }, [chatData?.id]); // Only depend on chatData.id - listener will handle real-time updates

  const displayName = selectedUser?.displayName || selectedUser?.fullName || selectedUser?.username || 'User';

  return (
    <div className="flex-1 flex flex-col border rounded-lg bg-zinc-100 h-full">
      {/* Chat Header */}
      <div className="w-full h-[4.5rem] flex items-center gap-3 px-3 md:px-5 border rounded-t-lg border-gray-200 bg-white shadow-sm flex-shrink-0">
        {onBack && (
          <button className="block md:hidden text-xl p-2 -ml-2 hover:bg-gray-100 rounded-full transition" onClick={onBack}>
            <IoArrowBackSharp />
          </button>
        )}

        <img 
          src={selectedUser?.photoURL || selectedUser?.avatar || ''} 
          alt="avatar" 
          className="w-10 h-10 rounded-full object-cover bg-gray-200 flex-shrink-0"
          onError={(e) => {
            e.target.src = 'https://ui-avatars.com/api/?name=' + encodeURIComponent(displayName);
          }}
        />

        <div className="flex flex-col flex-1 min-w-0">
          <span className="text-base md:text-lg font-medium text-gray-700 truncate">
            {displayName}
          </span>
        </div>
      </div>

      {/* Messages */}
      <div className="w-full flex-1 overflow-y-auto p-3 md:p-5 flex flex-col space-y-3 custom-scroll min-h-0">
        {sortedMessages.length === 0 ? (
          <p className="text-gray-400 text-sm text-center">No messages yet…</p>
        ) : (
          sortedMessages.map((msg) => (
            <Message
              key={msg.id}
              msg={msg}
              currentUser={currentUser}
              onEdit={(id, oldText) => {
                if (!chatData?.id) return;
                const newText = prompt("Edit your message:", oldText);
                if (newText && newText.trim()) {
                  dispatch(updateMessage({ chatId: chatData.id, messageId: id, newText }));
                }
              }}
              onDelete={(id) => {
                if (!chatData?.id) return;
                if (window.confirm("Delete this message?")) {
                  dispatch(deleteMessage({ chatId: chatData.id, messageId: id }));
                }
              }}
            />
          ))
        )}
      </div>


      {/* Input */}
      <div className="sticky bottom-0 rounded-b-lg w-full bg-white px-3 md:px-5 py-3 md:py-4 flex items-center gap-2 flex-shrink-0 border-t border-gray-200">
        <input
          type="text"
          placeholder="Type a message..."
          className="flex-1 bg-gray-100 text-gray-800 px-3 md:px-4 py-2 rounded-lg outline-none placeholder-gray-400 text-sm md:text-base"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleClick();
            }
          }}
          onFocus={() => {
            // Scroll to bottom on mobile when input is focused
            setTimeout(() => {
              const messagesContainer = document.querySelector('.custom-scroll');
              if (messagesContainer) {
                messagesContainer.scrollTop = messagesContainer.scrollHeight;
              }
            }, 100);
          }}
        />
        <button
          className="bg-blue-500 hover:bg-blue-600 active:bg-blue-700 p-2.5 md:px-5 md:py-2 rounded-full text-white transition-colors flex-shrink-0"
          onClick={handleClick}
          aria-label="Send message"
        >
          <span className="hidden md:block text-sm">Send message</span>
          <IoPaperPlane className="block md:hidden text-lg" />
        </button>
      </div>

    </div>
  );
}

export default React.memo(Chats);

