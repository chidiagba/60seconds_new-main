import { logger } from '@/lib/logger';
import { supabase } from '@/lib/supabase';
import { getSafeFileExtension, readUriAsArrayBuffer } from './media-upload';

/**
 * Converts a local image URI to ArrayBuffer
 */
export const uriToArrayBuffer = async (uri: string): Promise<ArrayBuffer> => {
  const { arrayBuffer } = await readUriAsArrayBuffer(uri, {
    allowedExtensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif'],
    fallbackExtension: 'jpg',
  });
  if (!arrayBuffer.byteLength) throw new Error('The selected image is empty. Please choose another photo.');
  return arrayBuffer;
};

/**
 * Gets the file extension from a URI
 */
export const getFileExtension = (uri: string): string => {
  return getSafeFileExtension(uri, ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif'], 'jpg');
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
    heic: 'image/heic',
    heif: 'image/heif',
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
    logger.debug('🔄 Starting image upload process...');
    logger.debug('📱 URI:', uri);
    logger.debug('👤 User ID:', userId);
    logger.debug('📁 Folder:', folder);
    
    // Convert URI to ArrayBuffer
    const arrayBuffer = await uriToArrayBuffer(uri);
    logger.debug('✅ Image converted to ArrayBuffer, size:', arrayBuffer.byteLength);
    
    // Get file extension and MIME type
    const extension = getFileExtension(uri);
    const mimeType = getMimeType(extension);
    logger.debug(`📁 File extension: ${extension}, MIME type: ${mimeType}`);
    
    // Generate unique filename
    const timestamp = Date.now();
    const randomId = Math.random().toString(36).substring(2, 8);
    const fileName = `${userId}_${timestamp}_${randomId}.${extension}`;
    const fullPath = `${folder}/${fileName}`;
    logger.debug(`📝 Generated filename: ${fullPath}`);
    
    // Try to upload directly first (bucket might already exist)
    logger.debug('⬆️ Attempting direct upload to Supabase Storage...');
    const { data, error } = await supabase.storage
      .from('images')
      .upload(fullPath, arrayBuffer, {
        contentType: mimeType,
        upsert: true, // Allow overwriting
      });
    
    if (error) {
      logger.error('❌ Direct upload failed:', error);
      
      // If bucket doesn't exist, try to create it
      if (error.message?.includes('Bucket not found') || error.message?.includes('bucket does not exist')) {
        logger.debug('🪣 Bucket not found, attempting to create...');
        
        try {
          const { error: createError } = await supabase.storage.createBucket('images', {
            public: true,
            allowedMimeTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
            fileSizeLimit: 5242880, // 5MB
          });
          
          if (createError) {
            logger.error('❌ Error creating bucket:', createError);
            // If bucket creation fails, try a different approach
            const error = createError as Error;
            throw new Error(`Failed to create storage bucket: ${error.message}`);
          }
          
          logger.debug('✅ Images bucket created, retrying upload...');
          
          // Retry upload after creating bucket
          const { data: retryData, error: retryError } = await supabase.storage
            .from('images')
            .upload(fullPath, arrayBuffer, {
              contentType: mimeType,
              upsert: true,
            });
          
          if (retryError) {
            logger.error('❌ Retry upload failed:', retryError);
            throw new Error(`Upload failed after bucket creation: ${retryError.message}`);
          }
          
          logger.debug('✅ Image uploaded successfully on retry:', retryData);
          
          // Get public URL
          const { data: urlData } = supabase.storage
            .from('images')
            .getPublicUrl(fullPath);
          
          const publicUrl = urlData.publicUrl;
          logger.debug('🔗 Public URL generated:', publicUrl);
          
          return publicUrl;
        } catch (createError) {
          logger.error('❌ Bucket creation failed:', createError);
          const error = createError as Error;
          throw new Error(`Storage setup failed: ${error.message}`);
        }
      } else {
        // Other upload errors
        throw new Error(`Upload failed: ${error.message}`);
      }
    }
    
    logger.debug('✅ Image uploaded successfully:', data);
    
    // Get public URL
    const { data: urlData } = supabase.storage
      .from('images')
      .getPublicUrl(fullPath);
    
    const publicUrl = urlData.publicUrl;
    logger.debug('🔗 Public URL generated:', publicUrl);
    
    return publicUrl;
  } catch (error) {
    logger.error('❌ Error in uploadImageToSupabase:', error);
    const err = error as Error;
    logger.error('❌ Error details:', {
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
    
    logger.debug('🗑️ Deleting image:', fullPath);
    
    const { error } = await supabase.storage
      .from('images')
      .remove([fullPath]);
    
    if (error) {
      logger.error('Error deleting image:', error);
      throw error;
    }
    
    logger.debug('✅ Image deleted successfully');
  } catch (error) {
    logger.error('❌ Error in deleteImageFromSupabase:', error);
    throw error;
  }
};
