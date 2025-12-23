import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import { ref, push, set, get, query, orderByChild, equalTo, onValue, off, remove, update, serverTimestamp } from "firebase/database";
import { realtimeDb, auth } from "../firebase/client";

// Helper function to get Telegram UID from auth user
// CRITICAL: Only returns Telegram UID, never Firebase-generated UIDs
// Firebase-generated UIDs are 28 characters long, Telegram UIDs are numeric strings
async function getTelegramUid() {
  if (!auth.currentUser) {
    return null;
  }
  
  try {
    // Priority 1: Get Telegram ID from token claims (set by backend) - this is the source of truth
    const tokenResult = await auth.currentUser.getIdTokenResult(true);
    const tokenClaims = tokenResult.claims || {};
    const telegramId = tokenClaims.telegramId?.toString();
    
    if (telegramId) {
      console.log('Got Telegram UID from token claims:', telegramId);
      return telegramId;
    }
    
    // Priority 2: Try to get from Telegram WebApp (always available in Telegram Mini App)
    const telegramProfile = window.Telegram?.WebApp?.initDataUnsafe?.user;
    if (telegramProfile?.id) {
      const tgId = telegramProfile.id.toString();
      console.log('Got Telegram UID from WebApp profile:', tgId);
      return tgId;
    }
    
    // Priority 3: Check if auth.uid is a Telegram UID (numeric)
    // Only use this if auth.uid is numeric (Telegram UID), not Firebase-generated
    const authUid = auth.currentUser.uid.toString();
    const isNumeric = /^\d+$/.test(authUid);
    const isFirebaseGenerated = authUid.length === 28;
    
    if (isNumeric && !isFirebaseGenerated) {
      // auth.uid is numeric, likely a Telegram UID
      console.log('Using auth.uid as Telegram UID (numeric):', authUid);
      return authUid;
    } else {
      // auth.uid is Firebase-generated, we can't use it
      // But we should have gotten Telegram UID from token claims or WebApp above
      console.error('auth.uid is Firebase-generated, not Telegram UID:', authUid);
      console.error('Could not get Telegram UID from token claims or WebApp. User may need to re-authenticate.');
      console.error('This usually means the user did not authenticate through the Telegram backend function.');
      return null;
    }
  } catch (error) {
    console.error('Error getting Telegram UID:', error);
    // Last resort: try Telegram WebApp directly (doesn't require async)
    const telegramProfile = window.Telegram?.WebApp?.initDataUnsafe?.user;
    if (telegramProfile?.id) {
      const tgId = telegramProfile.id.toString();
      console.log('Got Telegram UID from WebApp profile (fallback):', tgId);
      return tgId;
    }
    return null;
  }
}

export const createChat = createAsyncThunk(
  "chats/createChat",
  async (
    { members, type, groupName = null, groupPhotoURL = null },
    { rejectWithValue }
  ) => {
    try {
      // Check authentication first - required for database rules
      if (!auth.currentUser) {
        const errorMsg = 'User not authenticated. Please sign in and try again.';
        console.error(errorMsg);
        return rejectWithValue(errorMsg);
      }

      // CRITICAL: Use ONLY Telegram UID
      // Get Telegram UID from token claims (source of truth)
      const telegramUid = await getTelegramUid();
      if (!telegramUid) {
        const errorMsg = 'Could not get Telegram UID. Please re-authenticate.';
        console.error(errorMsg);
        return rejectWithValue(errorMsg);
      }
      
      // Get auth.uid (might be Firebase-generated, but we'll use Telegram UID for everything)
      const authUid = auth.currentUser.uid.toString();
      
      // Use ONLY Telegram UID for all operations
      const uidToUse = telegramUid;
      
      // Log warning if auth.uid is Firebase-generated (should be Telegram UID)
      if (authUid !== telegramUid) {
        if (authUid.length === 28) {
          console.warn(`WARNING: auth.uid is Firebase-generated (${authUid}), not Telegram UID (${telegramUid}).`);
          console.warn('This means user did not authenticate through Telegram backend. Database rules will check auth.uid.');
          console.warn('We will include auth.uid in members object for database rules, but use Telegram UID for everything else.');
        } else {
          console.warn(`auth.uid (${authUid}) doesn't match Telegram UID (${telegramUid}), but proceeding with Telegram UID`);
        }
      }
      
      console.log('Using Telegram UID for chat creation:', uidToUse);

      // Ensure all member UIDs are strings and ONLY Telegram UIDs (numeric)
      // Remove duplicates and filter out Firebase-generated UIDs
      const membersStr = [...new Set(members.map(m => m.toString()))]
        .filter(uid => {
          // Only allow numeric UIDs (Telegram UIDs)
          const isNumeric = /^\d+$/.test(uid);
          if (!isNumeric) {
            console.warn('Filtering out non-numeric UID (likely Firebase-generated):', uid);
          }
          return isNumeric;
        });
      
      // CRITICAL: Ensure Telegram UID is in members array
      if (!membersStr.includes(uidToUse)) {
        console.warn('Telegram UID not in members array, adding it:', uidToUse);
        membersStr.push(uidToUse);
      }
      
      // IMPORTANT: Database rules check auth.uid, so we MUST include it in members
      // Even if auth.uid is Firebase-generated, we need it for database rules to pass
      // But we'll use Telegram UID as the primary identifier
      if (authUid !== uidToUse && !membersStr.includes(authUid)) {
        console.warn(`auth.uid (${authUid}) is different from Telegram UID (${uidToUse}). Adding auth.uid to members for database rules.`);
        console.warn('NOTE: This should not happen if backend sets auth.uid correctly. Please re-authenticate.');
        membersStr.push(authUid);
      }
      
      // Final deduplication
      const uniqueMembers = [...new Set(membersStr)];
      if (type === 'direct') {
        // For direct chats, filter to only Telegram UIDs for membersArray
        // But keep auth.uid in members object for database rules
        const telegramMembers = uniqueMembers.filter(uid => /^\d+$/.test(uid));
        if (telegramMembers.length !== 2) {
          console.warn(`Direct chat should have exactly 2 Telegram UID members, found ${telegramMembers.length}:`, telegramMembers);
        }
      }
      
      // membersArray: ONLY Telegram UIDs (for our code)
      const finalMembersArray = uniqueMembers.filter(uid => /^\d+$/.test(uid));
      
      // members object: Include both Telegram UIDs AND auth.uid (for database rules)
      const membersMap = {};
      uniqueMembers.forEach(uid => {
        membersMap[uid] = true;
      });
      
      console.log('Creating chat:');
      console.log('  - Telegram UID:', uidToUse);
      console.log('  - auth.uid:', authUid);
      console.log('  - membersArray (Telegram UIDs only):', finalMembersArray);
      console.log('  - members object (includes auth.uid for rules):', Object.keys(membersMap));
      
      // Create new chat in Realtime Database
      const chatsRef = ref(realtimeDb, "chats");
      const newChatRef = push(chatsRef);
      const chatId = newChatRef.key;
      
      const chatData = {
        type,
        members: membersMap, // object/map - includes auth.uid for database rules
        membersArray: finalMembersArray, // array - ONLY Telegram UIDs for our code
        groupName: groupName || null,
        groupPhotoURL: groupPhotoURL || null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        lastMessage: null,
      };
      
      // Verify auth.uid is in members (required by database rules)
      if (!membersMap[authUid]) {
        const errorMsg = `auth.uid (${authUid}) not found in members map. This will cause PERMISSION_DENIED.`;
        console.error(errorMsg, { membersMap, authUid });
        return rejectWithValue(errorMsg);
      }
      
      // Verify Telegram UID is in membersArray (for our code)
      if (!finalMembersArray.includes(uidToUse)) {
        const errorMsg = `Telegram UID (${uidToUse}) not found in membersArray.`;
        console.error(errorMsg, { finalMembersArray, uidToUse });
        return rejectWithValue(errorMsg);
      }
      
      console.log('Writing chat to Realtime DB with Telegram UID in members:', {
        chatId,
        telegramUid: uidToUse,
        membersMap,
        hasTelegramUid: !!membersMap[uidToUse]
      });
      
      await set(newChatRef, chatData);
      
      console.log('Chat created successfully in Realtime DB:', chatId);

      // Return new chat data (no messages yet)
      return {
        id: chatId,
        ...chatData,
        messages: [],
      };
    } catch (err) {
      console.error('Error creating chat:', err);
      // Provide more detailed error message
      const errorMessage = err.message || err.code || 'Failed to create chat. Please try again.';
      return rejectWithValue(errorMessage);
    }
  }
);

export const fetchUserChats = createAsyncThunk(
  "chats/fetchUserChats",
  async (currentUserUid, { rejectWithValue }) => {
    try {
      // Check authentication first
      if (!auth.currentUser) {
        console.warn('User not authenticated, returning empty chats');
        return [];
      }

      // CRITICAL: Use Telegram UID only, not Firebase-generated UID
      const telegramUid = await getTelegramUid();
      if (!telegramUid) {
        console.warn('Could not get Telegram UID, returning empty chats');
        return [];
      }
      
      // Get auth.uid (might be Firebase-generated, but we'll use Telegram UID for membership checks)
      const authUidForRules = auth.currentUser.uid.toString();
      
      // Use Telegram UID for membership checks (our primary identifier)
      const searchUid = telegramUid;
      
      console.log('Fetching chats for Telegram UID:', searchUid);
      console.log('  - auth.uid (for database rules):', authUidForRules);
      console.log('  - Telegram UID (for membership):', searchUid);
      
      const chatsRef = ref(realtimeDb, "chats");
      
      // Get all chats
      const snapshot = await get(chatsRef);
      
      if (!snapshot.exists()) {
        console.log('No chats found in database');
        return [];
      }
      
      const allChats = snapshot.val();
      const userChats = [];
      
      // Filter chats where user is a member - simplified like chat-app
      for (const [chatId, chatData] of Object.entries(allChats)) {
        if (!chatData) continue;
        
        // Get members list - prefer membersArray, fallback to members object keys
        const membersArray = chatData.membersArray || [];
        const membersObj = chatData.members || {};
        
        // Normalize members list to strings for comparison
        let membersList = [];
        if (membersArray.length > 0) {
          membersList = membersArray.map(m => m.toString());
        } else if (membersObj && Object.keys(membersObj).length > 0) {
          membersList = Object.keys(membersObj).map(k => k.toString());
        }
        
        // Check membership: Use Telegram UID (primary) but also check auth.uid (for database rules compatibility)
        // membersArray should only have Telegram UIDs, but members object might have auth.uid too
        const isMemberByTelegramUid = membersList.includes(searchUid);
        const isMemberByAuthUid = membersList.includes(authUidForRules);
        
        // User is a member if their Telegram UID OR auth.uid is in the list
        // This handles cases where members object has auth.uid but membersArray has Telegram UID
        const isMember = isMemberByTelegramUid || isMemberByAuthUid;
        
        if (isMember) {
          console.log('Found chat user is member of:', chatId, 'members:', membersList);
          
          // Fetch messages for this chat
          const messagesRef = ref(realtimeDb, `chats/${chatId}/messages`);
          const messagesSnapshot = await get(messagesRef);
          
          let messages = [];
          if (messagesSnapshot.exists()) {
            const messagesData = messagesSnapshot.val();
            messages = Object.entries(messagesData || {}).map(([msgId, msgData]) => ({
              id: msgId,
              ...msgData,
            }));
            // Sort messages by createdAt to ensure proper order
            messages.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
            console.log(`Loaded ${messages.length} messages for chat ${chatId}`);
          } else {
            console.log(`No messages found for chat ${chatId}`);
          }
          
          // Ensure both formats exist for consistency
          // members object (for database rules)
          const finalMembersObj = membersObj && Object.keys(membersObj).length > 0 
            ? membersObj 
            : (() => {
                const obj = {};
                membersList.forEach(uid => obj[uid] = true);
                return obj;
              })();
          
          // Ensure membersArray exists (for code) - convert all to strings
          const finalMembersArray = membersList.map(uid => uid.toString());
          
          userChats.push({
            id: chatId,
            ...chatData,
            members: finalMembersObj,
            membersArray: finalMembersArray,
            messages,
          });
        }
      }
      
      console.log(`Fetched ${userChats.length} chats for user ${searchUid}`);
      return userChats;
    } catch (err) {
      console.error('Error fetching user chats:', err);
      return rejectWithValue(err.message);
    }
  }
);

export const sendMessage = createAsyncThunk(
  "chats/sendMessage",
  async ({ chatId, senderId, message, receiverId, receiverName, receiverPhotoURL }, { rejectWithValue }) => {
    try {
      // Check authentication first - required for database rules
      if (!auth.currentUser) {
        const errorMsg = 'User not authenticated. Please sign in and try again.';
        console.error(errorMsg);
        return rejectWithValue(errorMsg);
      }

      // CRITICAL: Use ONLY Telegram UID - backend sets auth.uid to Telegram ID
      const telegramUid = await getTelegramUid();
      if (!telegramUid) {
        const errorMsg = 'Could not get Telegram UID. Please re-authenticate.';
        console.error(errorMsg);
        return rejectWithValue(errorMsg);
      }
      
      // Get auth.uid (might be Firebase-generated, but we'll use Telegram UID for everything)
      const authUid = auth.currentUser.uid.toString();
      
      // Use ONLY Telegram UID for everything
      const senderIdToUse = telegramUid;
      
      // Log warning if auth.uid is Firebase-generated (should be Telegram UID)
      if (authUid !== telegramUid) {
        if (authUid.length === 28) {
          console.warn(`WARNING: auth.uid is Firebase-generated (${authUid}), not Telegram UID (${telegramUid}).`);
          console.warn('This means user did not authenticate through Telegram backend. Database rules will check auth.uid.');
          console.warn('We will use Telegram UID for senderId, but database rules need auth.uid in members object.');
        } else {
          console.warn(`auth.uid (${authUid}) doesn't match Telegram UID (${telegramUid}), but proceeding with Telegram UID`);
        }
      }
      
      // Verify senderId matches Telegram UID if provided
      if (senderId && senderId.toString() !== senderIdToUse) {
        console.warn(`senderId (${senderId}) doesn't match Telegram UID (${senderIdToUse}), using Telegram UID`);
      }
      
      // Get sender's Telegram profile info to store with message
      const senderTelegramProfile = window.Telegram?.WebApp?.initDataUnsafe?.user;
      const senderDisplayName = senderTelegramProfile 
        ? `${senderTelegramProfile.first_name || ''} ${senderTelegramProfile.last_name || ''}`.trim() || senderTelegramProfile.username || 'User'
        : null;
      const senderPhotoURL = senderTelegramProfile?.photo_url || null;

      console.log('Sending message to chat:', chatId, 'from Telegram UID:', senderIdToUse);
      
      // Verify the user is a member of this chat before sending
      const chatCheckRef = ref(realtimeDb, `chats/${chatId}`);
      const chatSnapshot = await get(chatCheckRef);
      
      if (!chatSnapshot.exists()) {
        const errorMsg = `Chat ${chatId} does not exist`;
        console.error(errorMsg);
        return rejectWithValue(errorMsg);
      }
      
      const chatData = chatSnapshot.val();
      const membersArray = chatData.membersArray || [];
      const membersObj = chatData.members || {};
      const membersList = membersArray.length > 0 
        ? membersArray.map(m => m.toString())
        : Object.keys(membersObj).map(k => k.toString());
      
      // Determine receiver if not provided - find the other member in the chat
      let finalReceiverId = receiverId?.toString();
      let finalReceiverName = receiverName;
      let finalReceiverPhotoURL = receiverPhotoURL;
      
      if (!finalReceiverId && chatData.type === 'direct') {
        // Find the other member (not the sender)
        const otherMember = membersList.find(m => m !== senderIdToUse && m !== authUid);
        if (otherMember) {
          finalReceiverId = otherMember;
          // Try to get receiver info from chat metadata or previous messages
          // This is a fallback - ideally receiver info should be passed from the component
        }
      }
      
      const msgData = {
        senderId: senderIdToUse, // ONLY Telegram UID
        message,
        createdAt: Date.now(),
        // Store sender profile info for display
        senderName: senderDisplayName,
        senderPhotoURL: senderPhotoURL,
        // Store receiver profile info for display (if available)
        receiverId: finalReceiverId || null,
        receiverName: finalReceiverName || null,
        receiverPhotoURL: finalReceiverPhotoURL || null,
      };
      
      // Get Telegram UID from token claims as fallback
      let telegramUidFromToken = null;
      try {
        const tokenResult = await auth.currentUser.getIdTokenResult(true);
        telegramUidFromToken = tokenResult.claims?.telegramId?.toString();
      } catch (tokenError) {
        console.warn('Could not get Telegram UID from token:', tokenError);
      }
      
      // Also try to get from Telegram WebApp
      const telegramProfile = window.Telegram?.WebApp?.initDataUnsafe?.user;
      const telegramProfileId = telegramProfile?.id?.toString();
      
      // Check if Telegram UID is in members (ONLY Telegram UIDs should be in members)
      // Also check if auth.uid is in members (for database rules compatibility)
      const isMemberByTelegramUid = membersList.includes(senderIdToUse);
      const isMemberByAuthUid = membersList.includes(authUid);
      
      // If Telegram UID is in membersArray but auth.uid is not in members object,
      // automatically add auth.uid to members object for database rules
      // This handles the case where receiver's auth.uid wasn't included when chat was created
      if (isMemberByTelegramUid && !isMemberByAuthUid) {
        console.warn(`Telegram UID ${senderIdToUse} is in membersArray, but auth.uid ${authUid} is not in members object.`);
        console.warn('Adding auth.uid to members object for database rules...');
        const chatUpdateRef = ref(realtimeDb, `chats/${chatId}/members`);
        try {
          await update(chatUpdateRef, {
            [authUid]: true
          });
          console.log('✅ Successfully added auth.uid to members object:', authUid);
          
          // Verify the update succeeded by re-reading the chat
          const verifyRef = ref(realtimeDb, `chats/${chatId}/members/${authUid}`);
          const verifySnapshot = await get(verifyRef);
          if (verifySnapshot.exists() && verifySnapshot.val() === true) {
            console.log('✅ Verified: auth.uid is now in members object');
            // Update membersList for subsequent checks
            membersList.push(authUid);
          } else {
            console.error('❌ Verification failed: auth.uid was not added to members object');
            throw new Error('Failed to verify auth.uid was added to members');
          }
        } catch (updateError) {
          console.error('❌ Failed to add auth.uid to members:', updateError);
          console.error('Update error details:', {
            code: updateError?.code,
            message: updateError?.message,
            stack: updateError?.stack
          });
          
          // If update fails, we still need to check if we can proceed
          // The database rules might allow it if senderId is in members
          console.warn('Attempting to send message anyway - database rules might allow it if senderId is in members');
        }
      }
      
      const isMember = isMemberByTelegramUid || isMemberByAuthUid;
      
      if (!isMember) {
        // User is truly not a member (neither Telegram UID nor auth.uid is in members)
        const errorMsg = `User with Telegram UID ${senderIdToUse} (auth.uid: ${authUid}) is not a member of chat ${chatId}. Members: ${membersList.join(', ')}`;
        console.error(errorMsg);
        console.error('Chat data:', chatData);
        console.error('  - Telegram UID in members:', isMemberByTelegramUid);
        console.error('  - auth.uid in members:', isMemberByAuthUid);
        return rejectWithValue(errorMsg);
      }
      
      console.log('✅ User is a member of chat. Telegram UID:', senderIdToUse, 'auth.uid:', authUid);
      console.log('  - Telegram UID in members:', isMemberByTelegramUid);
      console.log('  - auth.uid in members:', isMemberByAuthUid);
      console.log('  - Using Telegram UID as senderId:', senderIdToUse);

      // Add message to Realtime Database
      const messagesRef = ref(realtimeDb, `chats/${chatId}/messages`);
      const newMessageRef = push(messagesRef);
      const messageId = newMessageRef.key;
      
      try {
        console.log('Attempting to write message to database...');
        console.log('  - Message ID:', messageId);
        console.log('  - Chat ID:', chatId);
        console.log('  - Sender ID (Telegram UID):', senderIdToUse);
        console.log('  - Auth UID:', authUid);
        console.log('  - Auth UID in members:', membersList.includes(authUid));
        console.log('  - Sender ID in members:', membersList.includes(senderIdToUse));
        
        await set(newMessageRef, msgData);
        console.log('✅ Message successfully added to Realtime DB:', messageId);
      } catch (writeError) {
        console.error('❌ Error writing message to database:', writeError);
        console.error('Error details:', {
          code: writeError?.code,
          message: writeError?.message,
          stack: writeError?.stack
        });
        console.error('Message data:', msgData);
        console.error('Chat members:', membersList);
        console.error('Auth UID:', authUid);
        console.error('Telegram UID:', senderIdToUse);
        
        // Provide more helpful error message
        let errorMessage = writeError.message || 'Failed to write message to database';
        if (writeError.code === 'PERMISSION_DENIED') {
          errorMessage = `Permission denied: Your auth.uid (${authUid}) might not be in the chat members. Please try again.`;
        }
        
        return rejectWithValue(errorMessage);
      }

      // Update chat meta
      const chatUpdateRef = ref(realtimeDb, `chats/${chatId}`);
      await update(chatUpdateRef, {
        lastMessage: msgData,
        updatedAt: Date.now(),
      });

      return {
        chatId,
        message: { id: messageId, ...msgData },
      };
    } catch (err) {
      console.error('Error sending message:', err);
      return rejectWithValue(err.message);
    }
  }
);

export const deleteMessage = createAsyncThunk(
  "chats/deleteMessage",
  async ({ chatId, messageId }, { rejectWithValue }) => {
    try {
      // Check authentication first
      if (!auth.currentUser) {
        const errorMsg = 'User not authenticated. Please sign in and try again.';
        console.error(errorMsg);
        return rejectWithValue(errorMsg);
      }

      const msgRef = ref(realtimeDb, `chats/${chatId}/messages/${messageId}`);
      await remove(msgRef);

      return { chatId, messageId };
    } catch (err) {
      console.error('Error deleting message:', err);
      return rejectWithValue(err.message);
    }
  }
);

export const updateMessage = createAsyncThunk(
  "chats/updateMessage",
  async ({ chatId, messageId, newText }, { rejectWithValue }) => {
    try {
      // Check authentication first
      if (!auth.currentUser) {
        const errorMsg = 'User not authenticated. Please sign in and try again.';
        console.error(errorMsg);
        return rejectWithValue(errorMsg);
      }

      const msgRef = ref(realtimeDb, `chats/${chatId}/messages/${messageId}`);

      await update(msgRef, {
        message: newText,
        editedAt: Date.now()
      });

      return { chatId, messageId, newText };
    } catch (err) {
      console.error('Error updating message:', err);
      return rejectWithValue(err.message);
    }
  }
);

const initialState = {
  chats: [],
  status: "Pending...",
  error: null
}

const chatsSlice = createSlice({
  name: "chats",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    // fetch chats data
    builder
      .addCase(fetchUserChats.pending, (state) => {
        state.status = "Pending...";
        state.error = null;
      })
      .addCase(fetchUserChats.fulfilled, (state, action) => {
        state.status = "Success";
        state.chats = action.payload;
        state.error = null;
        console.log('Redux: Chats updated, count:', action.payload.length);
      })
      .addCase(fetchUserChats.rejected, (state, action) => {
        state.status = "failed";
        state.error = action.payload;
        console.error('Redux: Failed to fetch chats:', action.payload);
      })

    // send message
    builder
      .addCase(sendMessage.pending, (state) => {
        state.status = "Pending..."
      })
      .addCase(sendMessage.fulfilled, (state, action) => {
        const { chatId, message } = action.payload;
        // Find the chat in state
        const chatIndex = state.chats.findIndex((c) => c.id === chatId);
        if (chatIndex !== -1) {
          // Ensure messages array exists
          if (!state.chats[chatIndex].messages) {
            state.chats[chatIndex].messages = [];
          }
          // Check if message already exists (avoid duplicates)
          const messageExists = state.chats[chatIndex].messages.some(m => m.id === message.id);
          if (!messageExists) {
            state.chats[chatIndex].messages.push(message);
          }
          // Update lastMessage locally too
          state.chats[chatIndex].lastMessage = {
            message: message.message,
            senderId: message.senderId,
            createdAt: message.createdAt,
          };
          // Update updatedAt
          state.chats[chatIndex].updatedAt = Date.now();
        } else {
          // Chat not in state yet - this can happen if chat was just created
          // The real-time listener will pick it up
          console.warn('Chat not found in state when sending message:', chatId);
        }
      })
      .addCase(sendMessage.rejected, (state, action) => {
        state.status = "failed";
        state.error = action.payload;
      })

    // create new chat(start new chat)
    builder
      .addCase(createChat.pending, (state) => {
        state.status = "Pending...";
      })
      .addCase(createChat.fulfilled, (state, action) => {
        state.status = "Success";
        // Check if chat already exists (avoid duplicates)
        const existingIndex = state.chats.findIndex(c => c.id === action.payload.id);
        if (existingIndex === -1) {
          // Add the new chat to state
          state.chats.push(action.payload);
        } else {
          // Update existing chat
          state.chats[existingIndex] = action.payload;
        }
      })
      .addCase(createChat.rejected, (state, action) => {
        state.status = "failed";
        state.error = action.payload;
      });

    builder
      // ✅ Update message
      .addCase(updateMessage.fulfilled, (state, action) => {
        const { chatId, messageId, newText } = action.payload;
        const chatIndex = state.chats.findIndex((c) => c.id === chatId);
        if (chatIndex !== -1) {
          const msgIndex = state.chats[chatIndex].messages.findIndex(
            (m) => m.id === messageId
          );
          if (msgIndex !== -1) {
            state.chats[chatIndex].messages[msgIndex].message = newText;
            state.chats[chatIndex].messages[msgIndex].editedAt = Date.now();
          }
        }
      })
      .addCase(updateMessage.rejected, (state, action) => {
        state.error = action.payload;
      })

    builder
      .addCase(deleteMessage.fulfilled, (state, action) => {
        const { chatId, messageId } = action.payload;
        const chatIndex = state.chats.findIndex((c) => c.id === chatId);
        if (chatIndex !== -1) {
          state.chats[chatIndex].messages = state.chats[chatIndex].messages.filter(
            (m) => m.id !== messageId
          );
        }
      })
      .addCase(deleteMessage.rejected, (state, action) => {
        state.error = action.payload;
      });
  }
})

export default chatsSlice.reducer;
