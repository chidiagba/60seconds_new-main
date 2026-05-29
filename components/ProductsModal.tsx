import React from 'react';
import { Modal, View, StyleSheet, Pressable } from 'react-native';
import Colors from '@/constants/colors';
import ProductsList from './ProductsList';
import { Product } from '@/types';

interface ProductsModalProps {
  visible: boolean;
  onClose: () => void;
  videoId: string;
  products?: Product[];
  buyerEmail?: string | null;
  buyerId?: string | null;
}

export default function ProductsModal({ visible, onClose, videoId, products, buyerEmail, buyerId }: ProductsModalProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={styles.content}>
          <ProductsList videoId={videoId} onClose={onClose} products={products} buyerEmail={buyerEmail} buyerId={buyerId} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
  },
  content: {
    height: '70%',
    backgroundColor: Colors.dark.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: 'hidden',
  },
});