import React, { useState, useEffect, useContext, useMemo } from 'react'
import { useSelector, useDispatch } from "react-redux";

import { LuSearch } from "react-icons/lu";
import { GrFormClose } from "react-icons/gr";

import User from './User';
import { UserContext } from '../../context/userSelectionContext.jsx';
import { fetchUserProfile } from '../../services/firestoreService';
import { addUser } from '../../features/usersSlice';


function Sidebar() {
    const { query, setQuery } = useContext(UserContext)
    const [result, setResult] = useState([]);
    const { users } = useSelector((state) => state.users);
    const { currentUser } = useSelector((state) => state.users);
    const { chats } = useSelector((state) => state.chats);
    const dispatch = useDispatch();
    
    // Get users from existing chats - prioritize these
    // This ensures we show all users with existing conversations, even if they're not in the users list
    const usersFromChats = useMemo(() => {
        if (!currentUser?.uid || !chats || chats.length === 0) return [];
        
        const chatUsers = new Map();
        const currentUid = currentUser.uid.toString();
        
        chats.forEach(chat => {
            if (!chat || chat.type !== 'direct') return;
            
            const membersArray = chat.membersArray || [];
            const membersList = membersArray.length > 0 
                ? membersArray.map(m => m.toString())
                : (chat.members ? Object.keys(chat.members).map(k => k.toString()) : []);
            
            // Find the other member (not current user)
            membersList.forEach(memberUid => {
                if (memberUid !== currentUid && !chatUsers.has(memberUid)) {
                    // Try to find this user in the users list first
                    let chatUser = users.find(u => u.uid?.toString() === memberUid);
                    
                    // If user not found in users list, try to get from message sender/receiver info or fetch from DB
                    if (!chatUser) {
                        // First, try to get user info from messages
                        // Check both sender info (if this user sent a message) and receiver info (if this user received a message)
                        let userInfo = null;
                        if (chat.messages && chat.messages.length > 0) {
                            // Find a message from this user (sender info)
                            const userMessageAsSender = chat.messages.find(m => m.senderId?.toString() === memberUid);
                            if (userMessageAsSender && (userMessageAsSender.senderName || userMessageAsSender.senderPhotoURL)) {
                                userInfo = {
                                    displayName: userMessageAsSender.senderName || `User ${memberUid.slice(0, 8)}`,
                                    fullName: userMessageAsSender.senderName || `User ${memberUid.slice(0, 8)}`,
                                    photoURL: userMessageAsSender.senderPhotoURL || '',
                                    avatar: userMessageAsSender.senderPhotoURL || '',
                                };
                            } else {
                                // Find a message where this user was the receiver (receiver info)
                                const userMessageAsReceiver = chat.messages.find(m => m.receiverId?.toString() === memberUid);
                                if (userMessageAsReceiver && (userMessageAsReceiver.receiverName || userMessageAsReceiver.receiverPhotoURL)) {
                                    userInfo = {
                                        displayName: userMessageAsReceiver.receiverName || `User ${memberUid.slice(0, 8)}`,
                                        fullName: userMessageAsReceiver.receiverName || `User ${memberUid.slice(0, 8)}`,
                                        photoURL: userMessageAsReceiver.receiverPhotoURL || '',
                                        avatar: userMessageAsReceiver.receiverPhotoURL || '',
                                    };
                                }
                            }
                        }
                        
                        chatUser = {
                            uid: memberUid,
                            displayName: userInfo?.displayName || `User ${memberUid.slice(0, 8)}`,
                            fullName: userInfo?.fullName || `User ${memberUid.slice(0, 8)}`,
                            username: '',
                            photoURL: userInfo?.photoURL || '',
                            avatar: userInfo?.avatar || '',
                            // Mark as incomplete so we know to fetch full profile later
                            _incomplete: true
                        };
                    }
                    
                    chatUsers.set(memberUid, {
                        ...chatUser,
                        hasChat: true,
                        lastMessage: chat.lastMessage,
                        updatedAt: chat.updatedAt || chat.createdAt || 0,
                        messagesCount: chat.messages?.length || 0
                    });
                }
            });
        });
        
        return Array.from(chatUsers.values());
    }, [chats, users, currentUser?.uid]);
    
    // Combine: users from chats first, then other users
    const allUsersToShow = useMemo(() => {
        const chatUserIds = new Set(usersFromChats.map(u => u.uid?.toString()));
        const otherUsers = users.filter(u => {
            const uid = u.uid?.toString();
            return uid && uid !== currentUser?.uid?.toString() && !chatUserIds.has(uid);
        });
        
        // Sort users from chats by last message time (most recent first)
        const sortedChatUsers = [...usersFromChats].sort((a, b) => {
            const aTime = a.updatedAt || a.lastMessage?.createdAt || 0;
            const bTime = b.updatedAt || b.lastMessage?.createdAt || 0;
            return bTime - aTime;
        });
        
        return [...sortedChatUsers, ...otherUsers];
    }, [usersFromChats, users, currentUser?.uid]);

    useEffect(() => {
        const timer = setTimeout(() => {
            if (query) {
                const results = allUsersToShow.filter((user) => {
                    const displayName = user.displayName || user.fullName || user.username || '';
                    return displayName.toLowerCase().includes(query.toLowerCase());
                });
                setResult(results);
            } else{
                setResult([]);
            }
        }, 500);

        return () => clearTimeout(timer);
    }, [query, allUsersToShow])

    // Fetch user profiles for incomplete users
    useEffect(() => {
        const fetchIncompleteUsers = async () => {
            const incompleteUsers = allUsersToShow.filter(u => u._incomplete && u.uid);
            
            for (const user of incompleteUsers) {
                try {
                    const profile = await fetchUserProfile(user.uid);
                    if (profile) {
                        // Update user in Redux store
                        dispatch(addUser({
                            uid: profile.uid || profile.id,
                            displayName: profile.displayName || profile.fullName || profile.username || 'User',
                            fullName: profile.fullName || profile.displayName || profile.username || 'User',
                            username: profile.username || '',
                            photoURL: profile.photoURL || profile.avatar || '',
                            avatar: profile.avatar || profile.photoURL || '',
                        }));
                    }
                } catch (error) {
                    console.warn(`Failed to fetch profile for user ${user.uid}:`, error);
                }
            }
        };

        if (allUsersToShow.length > 0) {
            fetchIncompleteUsers();
        }
    }, [allUsersToShow, dispatch])

    const usersToRender = result.length > 0 ? result : allUsersToShow;
    const filteredUsers = usersToRender.filter(el => el.uid && el.uid !== currentUser?.uid?.toString());

    return (
        <div className="w-full md:w-[22rem] bg-zinc-100 border rounded-lg flex flex-col py-1 h-full">
            {/* Search */}
            <div className="w-full h-[4.5rem] flex justify-center items-center bg-none p-2 animate-fade-in">
                <div className="w-full md:min-w-[20rem] h-[3.3rem] bg-white rounded-lg shadow-lg p-3 flex transition-all duration-300 hover:shadow-xl">
                    <div className="col-span-1 flex justify-start items-center">
                        {query ? (
                            <GrFormClose 
                                className="text-xl cursor-pointer transition-all duration-200 hover:scale-110 active:scale-95" 
                                onClick={() => {
                                    setQuery("");
                                    setResult([]);
                                }} 
                            />
                        ) : (
                            <LuSearch className="text-lg transition-opacity duration-200" />
                        )}
                    </div>
                    <input 
                        className="col-span-11 w-full outline-none rounded-sm py-2 px-3 transition-all duration-300 focus:border-gray-900"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        type="text" 
                        name="search-chats" 
                        id="search-chats" 
                        placeholder="Search chats" 
                    />
                </div>
            </div>

            {/* Users list */}
            <div className="flex-1 overflow-y-auto p-2 space-y-2">
                {allUsersToShow.length === 0 ? (
                    <div className="flex items-center justify-center p-4 animate-fade-in">
                        <p className="text-sm text-gray-500">No users found</p>
                    </div>
                ) : (
                    <>
                        {filteredUsers.map((el, index) => (
                            <div
                                key={el.uid}
                                className="animate-fade-in-up"
                                style={{ animationDelay: `${index * 30}ms` }}
                            >
                                <User user={el} />
                            </div>
                        ))}
                    </>
                )}
            </div>
        </div>
    )
}

export default React.memo(Sidebar);

