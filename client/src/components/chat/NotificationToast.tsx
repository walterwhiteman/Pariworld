import { useEffect, useState } from 'react';
import { CheckCircle, AlertCircle, Info, AlertTriangle, X } from 'lucide-react';
import { NotificationData } from '@/types/chat';

interface NotificationToastProps {
  notifications: NotificationData[];
  onDismiss: (id: string) => void;
}

/**
 * Custom notification toast component for displaying success, error, and info messages
 * Replaces browser alerts with a more user-friendly notification system
 */
export function NotificationToast({ notifications, onDismiss }: NotificationToastProps) {
  
  /**
   * Auto-dismiss notifications after specified duration
   */
  useEffect(() => {
    notifications.forEach(notification => {
      if (notification.duration !== 0) { // 0 means persist until manually dismissed
        const timer = setTimeout(() => {
          onDismiss(notification.id);
        }, notification.duration || 5000); // Default 5 seconds
        
        return () => clearTimeout(timer);
      }
    });
  }, [notifications, onDismiss]);

  /**
   * Get icon component based on notification type
   */
  const getIcon = (type: NotificationData['type']) => {
    const iconClass = "h-5 w-5 flex-shrink-0";
    
    switch (type) {
      case 'success':
        return <CheckCircle className={`${iconClass} text-green-500`} />;
      case 'error':
        return <AlertCircle className={`${iconClass} text-red-500`} />;
      case 'warning':
        return <AlertTriangle className={`${iconClass} text-yellow-500`} />;
      case 'info':
      default:
        return <Info className={`${iconClass} text-blue-500`} />;
    }
  };

  /**
   * Get background color based on notification type
   */
  const getBackgroundColor = (type: NotificationData['type']) => {
    switch (type) {
      case 'success':
        return 'bg-green-50 border-green-200';
      case 'error':
        return 'bg-red-50 border-red-200';
      case 'warning':
        return 'bg-yellow-50 border-yellow-200';
      case 'info':
      default:
        return 'bg-blue-50 border-blue-200';
    }
  };

  if (notifications.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-50 space-y-2">
      {notifications.map((notification) => (
        <div
          key={notification.id}
          className={`
            min-w-[320px] max-w-md rounded-lg border p-4 shadow-lg transition-all duration-300 
            ${getBackgroundColor(notification.type)}
            animate-in slide-in-from-right-full
          `}
        >
          <div className="flex items-start space-x-3">
            {/* Icon */}
            {getIcon(notification.type)}
            
            {/* Content */}
            <div className="flex-1 min-w-0">
              <h4 className="text-sm font-medium text-gray-900">
                {notification.title}
              </h4>
              {notification.message && (
                <p className="mt-1 text-sm text-gray-600">
                  {notification.message}
                </p>
              )}
            </div>
            
            {/* Dismiss Button */}
            <button
              onClick={() => onDismiss(notification.id)}
              className="flex-shrink-0 text-gray-400 hover:text-gray-600 transition-colors"
              title="Dismiss notification"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
