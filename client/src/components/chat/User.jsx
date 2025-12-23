import React, { useContext } from "react";
import { useDispatch } from "react-redux";

import { selectUser } from '../../features/usersSlice';
import { UserContext } from "../../context/userSelectionContext";

function User({ user }) {
  const { setQuery } = useContext(UserContext)
  const dispatch = useDispatch();
  
  if (!user || !user.uid) {
    return null;
  }
  
  const { displayName, fullName, username, photoURL, avatar } = user;
  const displayNameToShow = displayName || fullName || username || 'User';
  const photoToShow = photoURL || avatar || '';

  const HandleClick = (user) => {
    if (!user?.uid) return;
    dispatch(selectUser(user));
    setQuery("");
  }

  return (
    <div className="flex items-center gap-3 md:gap-4 p-3 md:p-4 bg-white hover:bg-gray-100 active:bg-gray-200 rounded-xl shadow-lg cursor-pointer transition-all duration-200 touch-manipulation hover:scale-[1.02] hover:shadow-xl active:scale-[0.98] group" onClick={() => HandleClick(user)} key={user.uid}>
      {/* User Avatar */}
      <img
        src={photoToShow}
        alt={displayNameToShow}
        className="w-10 h-10 md:w-12 md:h-12 rounded-full object-cover flex-shrink-0 transition-transform duration-200 group-hover:scale-110"
        onError={(e) => {
          e.target.src = 'https://ui-avatars.com/api/?name=' + encodeURIComponent(displayNameToShow);
        }}
      />

      {/* User Info */}
      <div className="flex flex-col flex-1 min-w-0">
        <h3 className="text-base md:text-lg font-semibold text-gray-900 truncate transition-colors duration-200 group-hover:text-gray-600">{displayNameToShow}</h3>
        {username && <p className="text-xs md:text-sm text-zinc-500 truncate transition-opacity duration-200 group-hover:opacity-80">@{username}</p>}
      </div>
    </div>
  );
}

export default User;

