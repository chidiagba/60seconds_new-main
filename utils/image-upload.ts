import { supabase } from '@/lib/supabase';

/**
 * Converts a local image URI to ArrayBuffer
 */
export const uriToArrayBuffer = async (uri: string): Promise<ArrayBuffer> => {
  try {
    const response = await fetch(uri);
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.statusText}`);
    }
    return await response.arrayBuffer();
  } catch (error) {
    console.error('Error converting URI to ArrayBuffer:', error);
    throw new Error('Failed to process image');
  }
};

/**
 * Gets the file extension from a URI
 */
export const getFileExtension = (uri: string): string => {
  const match = uri.match(/\.([^.]+)$/);
  return match ? match[1] : 'jpg';
};

/**
 * Gets the MIME type from a file extension
 */
export const getMimeType = (extension: string): string => {
  const mimeTypes: { [key: string]: string } = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
  };
  return mimeTypes[extension.toLowerCase()] || 'image/jpeg';
};

/**
 * Uploads an image from local URI to Supabase Storage
 */
export const uploadImageToSupabase = async (
  uri: string,
  userId: string,
  folder: string = 'avatars'
): Promise<string> => {
  try {
    console.log('🔄 Starting image upload process...');
    console.log('📱 URI:', uri);
    console.log('👤 User ID:', userId);
    console.log('📁 Folder:', folder);
    
    // Convert URI to ArrayBuffer
    const arrayBuffer = await uriToArrayBuffer(uri);
    console.log('✅ Image converted to ArrayBuffer, size:', arrayBuffer.byteLength);
    
    // Get file extension and MIME type
    const extension = getFileExtension(uri);
    const mimeType = getMimeType(extension);
    console.log(`📁 File extension: ${extension}, MIME type: ${mimeType}`);
    
    // Generate unique filename
    const timestamp = Date.now();
    const randomId = Math.random().toString(36).substring(2, 8);
    const fileName = `${userId}_${timestamp}_${randomId}.${extension}`;
    const fullPath = `${folder}/${fileName}`;
    console.log(`📝 Generated filename: ${fullPath}`);
    
    // Try to upload directly first (bucket might already exist)
    console.log('⬆️ Attempting direct upload to Supabase Storage...');
    const { data, error } = await supabase.storage
      .from('images')
      .upload(fullPath, arrayBuffer, {
        contentType: mimeType,
        upsert: true, // Allow overwriting
      });
    
    if (error) {
      console.error('❌ Direct upload failed:', error);
      
      // If bucket doesn't exist, try to create it
      if (error.message?.includes('Bucket not found') || error.message?.includes('bucket does not exist')) {
        console.log('🪣 Bucket not found, attempting to create...');
        
        try {
          const { error: createError } = await supabase.storage.createBucket('images', {
            public: true,
            allowedMimeTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
            fileSizeLimit: 5242880, // 5MB
          });
          
          if (createError) {
            console.error('❌ Error creating bucket:', createError);
            // If bucket creation fails, try a different approach
            const error = createError as Error;
            throw new Error(`Failed to create storage bucket: ${error.message}`);
          }
          
          console.log('✅ Images bucket created, retrying upload...');
          
          // Retry upload after creating bucket
          const { data: retryData, error: retryError } = await supabase.storage
            .from('images')
            .upload(fullPath, arrayBuffer, {
              contentType: mimeType,
              upsert: true,
            });
          
          if (retryError) {
            console.error('❌ Retry upload failed:', retryError);
            throw new Error(`Upload failed after bucket creation: ${retryError.message}`);
          }
          
          console.log('✅ Image uploaded successfully on retry:', retryData);
          
          // Get public URL
          const { data: urlData } = supabase.storage
            .from('images')
            .getPublicUrl(fullPath);
          
          const publicUrl = urlData.publicUrl;
          console.log('🔗 Public URL generated:', publicUrl);
          
          return publicUrl;
        } catch (createError) {
          console.error('❌ Bucket creation failed:', createError);
          const error = createError as Error;
          throw new Error(`Storage setup failed: ${error.message}`);
        }
      } else {
        // Other upload errors
        throw new Error(`Upload failed: ${error.message}`);
      }
    }
    
    console.log('✅ Image uploaded successfully:', data);
    
    // Get public URL
    const { data: urlData } = supabase.storage
      .from('images')
      .getPublicUrl(fullPath);
    
    const publicUrl = urlData.publicUrl;
    console.log('🔗 Public URL generated:', publicUrl);
    
    return publicUrl;
  } catch (error) {
    console.error('❌ Error in uploadImageToSupabase:', error);
    const err = error as Error;
    console.error('❌ Error details:', {
      message: err.message,
      stack: err.stack,
      name: err.name
    });
    throw error;
  }
};

/**
 * Deletes an image from Supabase Storage
 */
export const deleteImageFromSupabase = async (url: string): Promise<void> => {
  try {
    // Extract file path from URL
    const urlParts = url.split('/');
    const fileName = urlParts[urlParts.length - 1];
    const folder = urlParts[urlParts.length - 2];
    const fullPath = `${folder}/${fileName}`;
    
    console.log('🗑️ Deleting image:', fullPath);
    
    const { error } = await supabase.storage
      .from('images')
      .remove([fullPath]);
    
    if (error) {
      console.error('Error deleting image:', error);
      throw error;
    }
    
    console.log('✅ Image deleted successfully');
  } catch (error) {
    console.error('❌ Error in deleteImageFromSupabase:', error);
    throw error;
  }
};
