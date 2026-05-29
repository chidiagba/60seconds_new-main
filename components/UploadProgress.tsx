import React from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { Check, AlertCircle, X } from 'lucide-react-native';
import Colors from '@/constants/colors';

export interface UploadProgressProps {
  progress: number;
  status: 'uploading' | 'processing' | 'complete' | 'error';
  onCancel?: () => void;
}

export default function UploadProgress({ progress, status, onCancel }: UploadProgressProps) {
  const getStatusText = () => {
    switch (status) {
      case 'uploading':
        return 'Uploading...';
      case 'processing':
        return 'Processing...';
      case 'complete':
        return 'Upload Complete!';
      case 'error':
        return 'Upload Failed';
      default:
        return 'Uploading...';
    }
  };

  const getStatusIcon = () => {
    switch (status) {
      case 'complete':
        return <Check size={24} color="#4CAF50" />;
      case 'error':
        return <AlertCircle size={24} color="#F44336" />;
      default:
        return <ActivityIndicator size="small" color={Colors.dark.primary} />;
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <View style={styles.header}>
          <Text style={styles.title}>{getStatusText()}</Text>
          <View style={styles.iconContainer}>
            {getStatusIcon()}
          </View>
        </View>
        
        <View style={styles.progressContainer}>
          <View style={styles.progressBackground}>
            <View 
              style={[
                styles.progressBar, 
                { width: `${progress}%` },
                status === 'error' && styles.progressBarError
              ]} 
            />
          </View>
          <Text style={styles.progressText}>{Math.round(progress)}%</Text>
        </View>
        
        <Text style={styles.description}>
          {status === 'uploading' && 'Your video is being uploaded. Please wait...'}
          {status === 'processing' && 'Your video is being processed. This may take a moment...'}
          {status === 'complete' && 'Your video has been successfully uploaded!'}
          {status === 'error' && 'There was an error uploading your video. Please try again.'}
        </Text>
        
        {(status === 'uploading' || status === 'processing') && onCancel && (
          <TouchableOpacity style={styles.cancelButton} onPress={onCancel}>
            <X size={16} color="#fff" />
            <Text style={styles.cancelButtonText}>Cancel Upload</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.dark.background,
    padding: 20,
  },
  card: {
    backgroundColor: Colors.dark.card,
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 400,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: Colors.dark.text,
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  progressContainer: {
    marginBottom: 24,
  },
  progressBackground: {
    height: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 8,
  },
  progressBar: {
    height: '100%',
    backgroundColor: Colors.dark.primary,
    borderRadius: 4,
  },
  progressBarError: {
    backgroundColor: '#F44336',
  },
  progressText: {
    fontSize: 14,
    color: Colors.dark.subtext,
    textAlign: 'right',
  },
  description: {
    fontSize: 14,
    color: Colors.dark.subtext,
    lineHeight: 20,
  },
  cancelButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F44336',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    marginTop: 16,
  },
  cancelButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 8,
  },
});