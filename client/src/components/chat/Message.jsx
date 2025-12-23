import React, { useState } from "react";
import { RiMore2Fill, RiPencilFill } from "react-icons/ri";
import { MdDelete } from "react-icons/md";
import { auth } from "../../firebase/client";

function Message({ msg, currentUser, onEdit, onDelete }) {
  const [showMenu, setShowMenu] = useState(false);

  // Convert both to strings for reliable comparison
  const senderId = msg.senderId?.toString();
  const currentUid = currentUser?.uid?.toString();
  
  // Compare senderId with currentUser.uid (both should be Telegram UIDs)
  // Also check auth.currentUser.uid as fallback
  const authUid = auth.currentUser?.uid?.toString();
  const isOwnMessage = senderId === currentUid || senderId === authUid;

  return (
    <div
      className={`relative flex flex-col w-full ${
        isOwnMessage ? "self-end items-end" : "self-start items-start"
      }`}
    >
      <div
        className={`max-w-[85%] md:max-w-[25rem] px-3 md:px-4 py-2 flex gap-2 rounded-2xl shadow break-words relative ${
          isOwnMessage
            ? "bg-blue-500 text-white"
            : "bg-gray-200 text-gray-800"
        }`}
      >
        {msg.message}
        {/* Options button */}
        {isOwnMessage && (
          <button
            onClick={() => setShowMenu((prev) => !prev)}
            className="text-lg text-white/80 hover:text-white"
          >
            <RiMore2Fill />
          </button>
        )}
      </div>

      {/* Dropdown menu */}
      {showMenu && (
        <>
          {/* Backdrop to close menu on mobile */}
          <div 
            className="fixed inset-0 z-[5] md:hidden" 
            onClick={() => setShowMenu(false)}
          />
          <div className="absolute top-full mt-1 bg-white rounded-md shadow-md border border-gray-200 text-sm right-0 w-28 md:w-24 z-10">
            <button
              onClick={() => {
                setShowMenu(false);
                onEdit(msg.id, msg.message);
              }}
              className="flex items-center gap-2 w-full px-3 py-2.5 hover:bg-gray-100 active:bg-gray-200 text-gray-700 transition-colors"
            >
              <RiPencilFill /> Edit
            </button>
            <button
              onClick={() => {
                setShowMenu(false);
                onDelete(msg.id);
              }}
              className="flex items-center gap-2 w-full px-3 py-2.5 hover:bg-gray-100 active:bg-gray-200 text-red-600 transition-colors"
            >
              <MdDelete /> Delete
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default Message;

