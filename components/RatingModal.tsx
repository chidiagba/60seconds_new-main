import React, { useState } from 'react';
import { Modal, View, Text, StyleSheet, TouchableOpacity, Pressable } from 'react-native';
import { Star } from 'lucide-react-native';
import Colors from '@/constants/colors';
import { RatingValue } from '@/types';

interface RatingModalProps {
  visible: boolean;
  onClose: () => void;
  onSubmit: (rating: RatingValue) => void;
  currentRating?: number;
}

export default function RatingModal({ visible, onClose, onSubmit, currentRating }: RatingModalProps) {
  const [selectedRating, setSelectedRating] = useState<RatingValue>(3);

  const handleSubmit = () => {
    onSubmit(selectedRating);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.overlay} onPress={onClose}>
        <View style={styles.modalContent} onStartShouldSetResponder={() => true}>
          <Text style={styles.title}>Rate this event</Text>
          <Text style={styles.subtitle}>Current rating: {currentRating ? currentRating.toFixed(1) : 'No rating'}</Text>
          
          <View style={styles.starsContainer}>
            {[1, 2, 3, 4, 5].map((rating) => (
              <TouchableOpacity
                key={rating}
                onPress={() => setSelectedRating(rating as RatingValue)}
                style={styles.starButton}
              >
                <Star
                  size={40}
                  color={Colors.dark.primary}
                  fill={rating <= selectedRating ? Colors.dark.primary : 'transparent'}
                />
              </TouchableOpacity>
            ))}
          </View>
          
          <View style={styles.buttonContainer}>
            <TouchableOpacity style={styles.cancelButton} onPress={onClose}>
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.submitButton} onPress={handleSubmit}>
              <Text style={styles.submitButtonText}>Submit</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    width: '80%',
    backgroundColor: Colors.dark.card,
    borderRadius: 15,
    padding: 20,
    alignItems: 'center',
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: Colors.dark.text,
    marginBottom: 5,
  },
  subtitle: {
    fontSize: 16,
    color: Colors.dark.subtext,
    marginBottom: 20,
  },
  starsContainer: {
    flexDirection: 'row',
    marginBottom: 20,
  },
  starButton: {
    padding: 5,
  },
  buttonContainer: {
    flexDirection: 'row',
    width: '100%',
    justifyContent: 'space-between',
  },
  cancelButton: {
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.dark.primary,
    width: '45%',
    alignItems: 'center',
  },
  cancelButtonText: {
    color: Colors.dark.primary,
    fontWeight: 'bold',
  },
  submitButton: {
    padding: 12,
    borderRadius: 8,
    backgroundColor: Colors.dark.primary,
    width: '45%',
    alignItems: 'center',
  },
  submitButtonText: {
    color: Colors.dark.text,
    fontWeight: 'bold',
  },
});