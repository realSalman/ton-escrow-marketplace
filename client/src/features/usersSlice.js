import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import { getDocs, setDoc, collection, doc } from "firebase/firestore";
import { db } from "../firebase/client";

export const fetchUsers = createAsyncThunk("fetchusers", async () => {
    const querySnapshot = await getDocs(collection(db, "users"));
    const usersList = querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        uid: doc.id, // Ensure uid is set to document ID (Telegram UID)
    }));

    return usersList;
})

export const addUser = createAsyncThunk(
    "users/addUser",
    async ({ uid, displayName, fullName, firstName, lastName, username, avatar, photoURL }, { rejectWithValue }) => {
        try {
            // Use Telegram UID as document ID
            await setDoc(doc(db, "users", uid), {
                uid,
                displayName: displayName || fullName || username || 'User',
                fullName: fullName || displayName || username || 'User',
                firstName: firstName || '',
                lastName: lastName || '',
                username: username || '',
                email: '', // No email for Telegram users
                photoURL: photoURL || avatar || '',
                online: true,
                createdAt: new Date()
            });

            // return the user object so Redux can update state immediately
            return { 
                uid, 
                displayName: displayName || fullName || username || 'User',
                fullName: fullName || displayName || username || 'User',
                firstName: firstName || '',
                lastName: lastName || '',
                username: username || '',
                email: '',
                photoURL: photoURL || avatar || '',
                online: true 
            };
        } catch (error) {
            return rejectWithValue(error.message);
        }
    }
);

const initialState = {
    users: [],
    currentUser: {},
    selectedUser: {},
    status: "Pending...",
    error: null
}

const userSlice = createSlice({
    name: "users",
    initialState,
    reducers: {
        setCurrentUser: (state, action) => {
            state.currentUser = action.payload;
        },

        selectUser: (state, action) => {
            state.selectedUser = action.payload;
        }
    },
    extraReducers: (builder) => {
        builder
            .addCase(fetchUsers.pending, (state) => {
                state.status = "Pending...";
            })
            .addCase(fetchUsers.fulfilled, (state, action) => {
                state.status = "Success";
                state.users = action.payload;
            })
            .addCase(fetchUsers.rejected, (state, action) => {
                state.status = "failed";
                state.error = action.payload;
            });

        builder
            .addCase(addUser.pending, (state) => {
                state.status = "Adding user...";
            })
            .addCase(addUser.fulfilled, (state, action) => {
                state.status = "User added";
                // Check if user already exists, if not add it
                const existingIndex = state.users.findIndex(u => u.uid === action.payload.uid);
                if (existingIndex >= 0) {
                    state.users[existingIndex] = action.payload;
                } else {
                    state.users.push(action.payload);
                }
            })
            .addCase(addUser.rejected, (state, action) => {
                state.status = "failed";
                state.error = action.payload;
            });
    },
})

export default userSlice.reducer;
export const { setCurrentUser, selectUser } = userSlice.actions;

