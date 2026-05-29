# Delete Account Feature Setup Guide

This guide explains how to set up the delete account functionality in your app.

## Overview

The delete account feature allows users to permanently delete their account and all associated data. This includes:
- User profile
- Wallet data
- Transactions
- Orders
- Vouchers
- Products
- Events
- Videos
- Comments
- Likes
- Follows
- Messages
- Chats

## Setup Instructions

### 1. Create the Database Function

Run the SQL from `delete-user-function.sql` in your Supabase SQL Editor:

```sql
-- This creates a function that safely deletes all user data
CREATE OR REPLACE FUNCTION delete_user(user_id uuid)
RETURNS void AS $$
BEGIN
  -- Delete all user-related data
  DELETE FROM transactions WHERE user_id = delete_user.user_id OR recipient_id = delete_user.user_id;
  DELETE FROM wallets WHERE user_id = delete_user.user_id;
  DELETE FROM orders WHERE user_id = delete_user.user_id;
  DELETE FROM vouchers WHERE business_id = delete_user.user_id;
  DELETE FROM products WHERE business_id = delete_user.user_id;
  DELETE FROM events WHERE creator_id = delete_user.user_id;
  DELETE FROM videos WHERE user_id = delete_user.user_id;
  DELETE FROM comments WHERE user_id = delete_user.user_id;
  DELETE FROM likes WHERE user_id = delete_user.user_id;
  DELETE FROM follows WHERE follower_id = delete_user.user_id OR following_id = delete_user.user_id;
  DELETE FROM messages WHERE sender_id = delete_user.user_id OR receiver_id = delete_user.user_id;
  DELETE FROM chats WHERE user1_id = delete_user.user_id OR user2_id = delete_user.user_id;
  DELETE FROM profiles WHERE id = delete_user.user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION delete_user(uuid) TO authenticated;
```

### 2. How It Works

1. User navigates to Settings
2. User clicks on "Delete Account" in the Danger Zone section
3. User is shown a confirmation dialog
4. User is shown a second confirmation dialog (to prevent accidental deletion)
5. The app calls the `deleteAccount()` function from the auth context
6. The function calls the `delete_user` RPC function in Supabase
7. All user data is deleted from the database
8. The user is signed out
9. The user is redirected to the sign-in page

### 3. Features

- **Two-step confirmation**: Prevents accidental account deletion
- **Loading state**: Shows a loading indicator while the account is being deleted
- **Error handling**: Shows an error message if deletion fails
- **Complete data removal**: Deletes all user data from all tables
- **Automatic sign-out**: Signs the user out after deletion

### 4. UI Location

The delete account feature is located in:
- **Screen**: Settings (`app/settings.tsx`)
- **Section**: Danger Zone
- **Appearance**: Red text and border to indicate the dangerous action

### 5. Important Notes

- **This action is irreversible**: Once deleted, user data cannot be recovered
- **Admin intervention required**: To completely remove the user from the auth system, you need to use Supabase dashboard or admin API
- **Cascading deletes**: Make sure your database has proper foreign key relationships set up if you want automatic cascading

### 6. Testing

To test the delete account feature:

1. Create a test user account
2. Add some data (create events, products, transactions, etc.)
3. Go to Settings
4. Click "Delete Account"
5. Confirm the deletion twice
6. Verify that:
   - The user is signed out
   - All user data is deleted from the database
   - The user cannot sign in with the same credentials

### 7. Customization

You can customize the delete account feature by:

- Modifying the confirmation dialogs in `app/settings.tsx`
- Adding more data deletion logic in the `delete_user` function
- Adding email notifications before/after deletion
- Adding a grace period before permanent deletion
- Creating an admin panel to recover deleted accounts within a certain timeframe

## Security Considerations

1. **Authentication**: The function can only be called by authenticated users
2. **User isolation**: Users can only delete their own account (enforced by passing their user_id)
3. **SECURITY DEFINER**: The function runs with elevated privileges to delete data across tables
4. **Confirmation**: Two confirmation dialogs prevent accidental deletion

## Troubleshooting

### Error: "Function delete_user does not exist"
- Make sure you ran the SQL script in your Supabase SQL editor
- Check that the function was created successfully

### Error: "Failed to delete account"
- Check the browser console for detailed error messages
- Verify that the user has permission to execute the function
- Check for foreign key constraints that might prevent deletion

### Data not deleted
- Verify that the `delete_user` function includes all tables you want to delete from
- Check for any tables with foreign key constraints that prevent deletion
- Add CASCADE DELETE constraints if needed
