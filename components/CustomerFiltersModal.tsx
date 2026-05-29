import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, TextInput, ScrollView } from 'react-native';
import { X, Calendar, DollarSign, Tag } from 'lucide-react-native';
import Colors from '@/constants/colors';
import { CustomerFilters, InteractionType } from '@/types';

interface CustomerFiltersModalProps {
  visible: boolean;
  onClose: () => void;
  onApplyFilters: (filters: CustomerFilters) => void;
  currentFilters: CustomerFilters;
}

export default function CustomerFiltersModal({
  visible,
  onClose,
  onApplyFilters,
  currentFilters
}: CustomerFiltersModalProps) {
  const [filters, setFilters] = useState<CustomerFilters>(currentFilters);
  const [minSpent, setMinSpent] = useState<string>('');
  const [maxSpent, setMaxSpent] = useState<string>('');
  const [newTag, setNewTag] = useState<string>('');

  useEffect(() => {
    setFilters(currentFilters);
    setMinSpent(currentFilters.minSpent?.toString() || '');
    setMaxSpent(currentFilters.maxSpent?.toString() || '');
  }, [currentFilters, visible]);

  const interactionTypes: InteractionType[] = ['view', 'like', 'comment', 'share', 'purchase'];
  const commonTags = ['VIP', 'Regular', 'New', 'Frequent', 'High Value'];

  const handleInteractionTypeSelect = (type: InteractionType) => {
    setFilters(prev => ({
      ...prev,
      interactionType: prev.interactionType === type ? undefined : type
    }));
  };

  const handleAddTag = () => {
    if (newTag.trim() && !filters.tags?.includes(newTag.trim())) {
      setFilters(prev => ({
        ...prev,
        tags: [...(prev.tags || []), newTag.trim()]
      }));
      setNewTag('');
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setFilters(prev => ({
      ...prev,
      tags: prev.tags?.filter(tag => tag !== tagToRemove)
    }));
  };

  const handleApply = () => {
    const finalFilters: CustomerFilters = {
      ...filters,
      minSpent: minSpent ? parseFloat(minSpent) : undefined,
      maxSpent: maxSpent ? parseFloat(maxSpent) : undefined,
    };
    onApplyFilters(finalFilters);
  };

  const handleClear = () => {
    setFilters({});
    setMinSpent('');
    setMaxSpent('');
    setNewTag('');
  };

  const getInteractionTypeLabel = (type: InteractionType) => {
    switch (type) {
      case 'view':
        return 'Views';
      case 'like':
        return 'Likes';
      case 'comment':
        return 'Comments';
      case 'share':
        return 'Shares';
      case 'purchase':
        return 'Purchases';
      default:
        return type;
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Filter Customers</Text>
          <TouchableOpacity style={styles.closeButton} onPress={onClose}>
            <X size={24} color={Colors.dark.text} />
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
          {/* Interaction Type Filter */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Interaction Type</Text>
            <View style={styles.interactionTypeGrid}>
              {interactionTypes.map(type => (
                <TouchableOpacity
                  key={type}
                  style={[
                    styles.interactionTypeButton,
                    filters.interactionType === type && styles.interactionTypeButtonActive
                  ]}
                  onPress={() => handleInteractionTypeSelect(type)}
                >
                  <Text style={[
                    styles.interactionTypeText,
                    filters.interactionType === type && styles.interactionTypeTextActive
                  ]}>
                    {getInteractionTypeLabel(type)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Spending Range Filter */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Spending Range</Text>
            <View style={styles.spendingRow}>
              <View style={styles.spendingInput}>
                <DollarSign size={16} color={Colors.dark.subtext} />
                <TextInput
                  style={styles.textInput}
                  placeholder="Min"
                  placeholderTextColor={Colors.dark.subtext}
                  value={minSpent}
                  onChangeText={setMinSpent}
                  keyboardType="numeric"
                />
              </View>
              <Text style={styles.spendingDivider}>to</Text>
              <View style={styles.spendingInput}>
                <DollarSign size={16} color={Colors.dark.subtext} />
                <TextInput
                  style={styles.textInput}
                  placeholder="Max"
                  placeholderTextColor={Colors.dark.subtext}
                  value={maxSpent}
                  onChangeText={setMaxSpent}
                  keyboardType="numeric"
                />
              </View>
            </View>
          </View>

          {/* Tags Filter */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Customer Tags</Text>
            
            {/* Common Tags */}
            <View style={styles.tagsGrid}>
              {commonTags.map(tag => (
                <TouchableOpacity
                  key={tag}
                  style={[
                    styles.tagButton,
                    filters.tags?.includes(tag) && styles.tagButtonActive
                  ]}
                  onPress={() => {
                    if (filters.tags?.includes(tag)) {
                      handleRemoveTag(tag);
                    } else {
                      setFilters(prev => ({
                        ...prev,
                        tags: [...(prev.tags || []), tag]
                      }));
                    }
                  }}
                >
                  <Text style={[
                    styles.tagButtonText,
                    filters.tags?.includes(tag) && styles.tagButtonTextActive
                  ]}>
                    {tag}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Custom Tag Input */}
            <View style={styles.customTagContainer}>
              <View style={styles.customTagInput}>
                <Tag size={16} color={Colors.dark.subtext} />
                <TextInput
                  style={styles.textInput}
                  placeholder="Add custom tag"
                  placeholderTextColor={Colors.dark.subtext}
                  value={newTag}
                  onChangeText={setNewTag}
                  onSubmitEditing={handleAddTag}
                />
              </View>
              <TouchableOpacity style={styles.addTagButton} onPress={handleAddTag}>
                <Text style={styles.addTagButtonText}>Add</Text>
              </TouchableOpacity>
            </View>

            {/* Selected Tags */}
            {filters.tags && filters.tags.length > 0 && (
              <View style={styles.selectedTagsContainer}>
                <Text style={styles.selectedTagsTitle}>Selected Tags:</Text>
                <View style={styles.selectedTagsGrid}>
                  {filters.tags.map(tag => (
                    <TouchableOpacity
                      key={tag}
                      style={styles.selectedTag}
                      onPress={() => handleRemoveTag(tag)}
                    >
                      <Text style={styles.selectedTagText}>{tag}</Text>
                      <X size={14} color={Colors.dark.text} />
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}
          </View>
        </ScrollView>

        {/* Action Buttons */}
        <View style={styles.actions}>
          <TouchableOpacity style={styles.clearButton} onPress={handleClear}>
            <Text style={styles.clearButtonText}>Clear All</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.applyButton} onPress={handleApply}>
            <Text style={styles.applyButtonText}>Apply Filters</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.divider,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: Colors.dark.text,
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
  },
  section: {
    marginVertical: 20,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.dark.text,
    marginBottom: 12,
  },
  interactionTypeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  interactionTypeButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: Colors.dark.card,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  interactionTypeButtonActive: {
    backgroundColor: Colors.dark.primary,
    borderColor: Colors.dark.primary,
  },
  interactionTypeText: {
    fontSize: 14,
    color: Colors.dark.subtext,
  },
  interactionTypeTextActive: {
    color: Colors.dark.text,
    fontWeight: '500',
  },
  spendingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  spendingInput: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.dark.card,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  spendingDivider: {
    color: Colors.dark.subtext,
    fontSize: 14,
  },
  textInput: {
    flex: 1,
    color: Colors.dark.text,
    fontSize: 16,
  },
  tagsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  tagButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: Colors.dark.card,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  tagButtonActive: {
    backgroundColor: Colors.dark.primary,
    borderColor: Colors.dark.primary,
  },
  tagButtonText: {
    fontSize: 12,
    color: Colors.dark.subtext,
  },
  tagButtonTextActive: {
    color: Colors.dark.text,
    fontWeight: '500',
  },
  customTagContainer: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  customTagInput: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.dark.card,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  addTagButton: {
    backgroundColor: Colors.dark.primary,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    justifyContent: 'center',
  },
  addTagButtonText: {
    color: Colors.dark.text,
    fontSize: 14,
    fontWeight: '500',
  },
  selectedTagsContainer: {
    marginTop: 8,
  },
  selectedTagsTitle: {
    fontSize: 14,
    color: Colors.dark.text,
    marginBottom: 8,
  },
  selectedTagsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  selectedTag: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.dark.primary,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  selectedTagText: {
    fontSize: 12,
    color: Colors.dark.text,
  },
  actions: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: Colors.dark.divider,
    gap: 12,
  },
  clearButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: Colors.dark.card,
    alignItems: 'center',
  },
  clearButtonText: {
    color: Colors.dark.subtext,
    fontSize: 16,
    fontWeight: '500',
  },
  applyButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: Colors.dark.primary,
    alignItems: 'center',
  },
  applyButtonText: {
    color: Colors.dark.text,
    fontSize: 16,
    fontWeight: 'bold',
  },
});