import { create } from "zustand";

export type UploadTaskStatus = "idle" | "uploading" | "processing" | "success" | "error";

type RetryAction = (() => Promise<void>) | null;

interface UploadTaskState {
  taskId: string | null;
  visible: boolean;
  progress: number;
  status: UploadTaskStatus;
  title: string;
  message: string;
  attempt: number;
  maxAttempts: number;
  canRetry: boolean;
  retryAction: RetryAction;
  startTask: (payload: {
    title?: string;
    message?: string;
    maxAttempts?: number;
    retryAction?: RetryAction;
  }) => string;
  updateTask: (
    taskId: string,
    updates: Partial<{
      progress: number;
      status: UploadTaskStatus;
      title: string;
      message: string;
      attempt: number;
      maxAttempts: number;
      canRetry: boolean;
      retryAction: RetryAction;
      visible: boolean;
    }>
  ) => void;
  markSuccess: (taskId: string, message?: string) => void;
  markError: (taskId: string, payload: { message: string; retryAction?: RetryAction }) => void;
  retryCurrentTask: () => Promise<void>;
  dismissTask: () => void;
}

const createTaskId = () => `upload_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

export const useUploadTaskStore = create<UploadTaskState>((set, get) => ({
  taskId: null,
  visible: false,
  progress: 0,
  status: "idle",
  title: "Uploading Event",
  message: "Preparing upload...",
  attempt: 1,
  maxAttempts: 4,
  canRetry: false,
  retryAction: null,

  startTask: ({ title, message, maxAttempts, retryAction }) => {
    const taskId = createTaskId();
    set({
      taskId,
      visible: true,
      progress: 2,
      status: "uploading",
      title: title || "Uploading Event",
      message: message || "Your upload is running in the background.",
      attempt: 1,
      maxAttempts: maxAttempts || 4,
      canRetry: false,
      retryAction: retryAction || null,
    });
    return taskId;
  },

  updateTask: (taskId, updates) => {
    if (get().taskId !== taskId) {
      return;
    }

    set((state) => ({
      ...state,
      ...updates,
    }));
  },

  markSuccess: (taskId, message) => {
    if (get().taskId !== taskId) {
      return;
    }

    set((state) => ({
      ...state,
      visible: true,
      progress: 100,
      status: "success",
      message: message || "Upload complete.",
      canRetry: false,
      retryAction: null,
    }));
  },

  markError: (taskId, { message, retryAction }) => {
    if (get().taskId !== taskId) {
      return;
    }

    set((state) => ({
      ...state,
      visible: true,
      status: "error",
      progress: Math.min(state.progress, 100),
      message,
      canRetry: Boolean(retryAction),
      retryAction: retryAction || null,
    }));
  },

  retryCurrentTask: async () => {
    const retryAction = get().retryAction;
    if (!retryAction) {
      return;
    }

    set((state) => ({
      ...state,
      visible: true,
      status: "uploading",
      progress: 2,
      message: "Retrying upload...",
      canRetry: false,
    }));

    await retryAction();
  },

  dismissTask: () => {
    set({
      taskId: null,
      visible: false,
      progress: 0,
      status: "idle",
      title: "Uploading Event",
      message: "",
      attempt: 1,
      maxAttempts: 4,
      canRetry: false,
      retryAction: null,
    });
  },
}));