-- Function to delete all user data
-- This should be run in your Supabase SQL editor

CREATE OR REPLACE FUNCTION delete_user(user_id uuid)
RETURNS void AS $$
BEGIN
  -- Delete user's transactions
  DELETE FROM transactions WHERE user_id = delete_user.user_id OR recipient_id = delete_user.user_id;
  
  -- Delete user's wallets
  DELETE FROM wallets WHERE user_id = delete_user.user_id;
  
  -- Delete user's orders
  DELETE FROM orders WHERE user_id = delete_user.user_id;
  
  -- Delete user's vouchers
  DELETE FROM vouchers WHERE business_id = delete_user.user_id;
  
  -- Delete user's products
  DELETE FROM products WHERE business_id = delete_user.user_id;
  
  -- Delete user's events
  DELETE FROM events WHERE creator_id = delete_user.user_id;
  
  -- Delete user's videos
  DELETE FROM videos WHERE user_id = delete_user.user_id;
  
  -- Delete user's comments
  DELETE FROM comments WHERE user_id = delete_user.user_id;
  
  -- Delete user's likes
  DELETE FROM likes WHERE user_id = delete_user.user_id;
  
  -- Delete user's followers
  DELETE FROM follows WHERE follower_id = delete_user.user_id OR following_id = delete_user.user_id;
  
  -- Delete user's messages
  DELETE FROM messages WHERE sender_id = delete_user.user_id OR receiver_id = delete_user.user_id;
  
  -- Delete user's chats
  DELETE FROM chats WHERE user1_id = delete_user.user_id OR user2_id = delete_user.user_id;
  
  -- Finally, delete the user profile
  DELETE FROM profiles WHERE id = delete_user.user_id;
  
  -- Note: The auth.users entry will be deleted by the app using admin API
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission to authenticated users (they can only delete their own account)
GRANT EXECUTE ON FUNCTION delete_user(uuid) TO authenticated;
