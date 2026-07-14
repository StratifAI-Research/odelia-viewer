import React, { useState, useEffect } from 'react';
import { Button, Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription } from '@ohif/ui-next';
import {
  AI_ENDPOINTS_STORAGE_KEY,
  DEFAULT_AI_ENDPOINT_NAME,
  DEFAULT_AI_ENDPOINT_URL,
} from '../constants';

// Interface for AI endpoint configuration
export interface AIEndpoint {
  id: string;
  name: string;
  url: string;
  username?: string;
  password?: string;
}

interface AIEndpointConfigProps {
  onEndpointChange: (endpoint: AIEndpoint) => void;
  currentEndpoint: AIEndpoint | null;
  compact?: boolean;
}

// Default AI endpoint configuration
const DEFAULT_ENDPOINT: AIEndpoint = {
  id: 'default-ai-server',
  name: DEFAULT_AI_ENDPOINT_NAME,
  url: DEFAULT_AI_ENDPOINT_URL,
};

/**
 * Remove secrets (password) from endpoints before persisting them. Credentials must
 * never be written to localStorage in plaintext; they are not transmitted by routing
 * requests anyway, so persisting them is pure liability.
 */
export const stripEndpointSecrets = (endpoints: AIEndpoint[]): AIEndpoint[] =>
  endpoints.map(({ password, ...rest }) => rest);

const AIEndpointConfig: React.FC<AIEndpointConfigProps> = ({
  onEndpointChange,
  currentEndpoint,
  compact = false,
}) => {
  const [endpoints, setEndpoints] = useState<AIEndpoint[]>([]);
  const [isFormVisible, setIsFormVisible] = useState(false);
  const [editingEndpoint, setEditingEndpoint] = useState<AIEndpoint | null>(null);
  const [formData, setFormData] = useState<AIEndpoint>({
    id: '',
    name: '',
    url: '',
    username: '',
    password: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);

  // Load endpoints from localStorage or config on component mount
  useEffect(() => {
    let loadedEndpoints: AIEndpoint[] = [];

    // First, check if user has saved endpoints (priority)
    const savedEndpoints = localStorage.getItem(AI_ENDPOINTS_STORAGE_KEY);
    if (savedEndpoints) {
      try {
        loadedEndpoints = JSON.parse(savedEndpoints);
      } catch (error) {
        console.error('Failed to parse saved AI endpoints:', error);
        loadedEndpoints = [];
      }
    }

    // If no localStorage data, load from config
    if (loadedEndpoints.length === 0) {
      const configEndpoints: AIEndpoint[] = (window as any).config?.aiEndpoints || [];
      if (configEndpoints.length > 0) {
        loadedEndpoints = configEndpoints;
      } else {
        // If no config either, use default
        loadedEndpoints = [DEFAULT_ENDPOINT];
      }
      // Save to localStorage for future
      localStorage.setItem(AI_ENDPOINTS_STORAGE_KEY, JSON.stringify(stripEndpointSecrets(loadedEndpoints)));
    }

    setEndpoints(loadedEndpoints);
    setIsLoading(false);

    // If no current endpoint is selected, select the first one
    if (!currentEndpoint && loadedEndpoints.length > 0) {
      onEndpointChange(loadedEndpoints[0]);
    }
  }, [currentEndpoint, onEndpointChange]);

  // Save endpoints to localStorage whenever they change
  useEffect(() => {
    if (endpoints.length > 0) {
      localStorage.setItem(AI_ENDPOINTS_STORAGE_KEY, JSON.stringify(stripEndpointSecrets(endpoints)));
    }
  }, [endpoints]);

  const handleOpenForm = (endpoint?: AIEndpoint) => {
    if (endpoint) {
      setEditingEndpoint(endpoint);
      setFormData({ ...endpoint });
    } else {
      setEditingEndpoint(null);
      setFormData({
        id: '',
        name: '',
        url: '',
        username: '',
        password: '',
      });
    }
    setIsFormVisible(true);
  };

  const handleCloseForm = () => {
    setIsFormVisible(false);
    setEditingEndpoint(null);
    setErrors({});
    setShowDeleteConfirmation(false);
  };

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.name.trim()) {
      newErrors.name = 'Name is required';
    }

    if (!formData.url.trim()) {
      newErrors.url = 'URL is required';
    } else if (!formData.url.startsWith('http://') && !formData.url.startsWith('https://')) {
      newErrors.url = 'URL must start with http:// or https://';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = () => {
    if (!validateForm()) {
      return;
    }

    const newEndpoint: AIEndpoint = {
      ...formData,
      id: editingEndpoint?.id || `endpoint-${Date.now()}`,
    };

    let updatedEndpoints: AIEndpoint[];

    if (editingEndpoint) {
      // Update existing endpoint
      updatedEndpoints = endpoints.map(endpoint =>
        endpoint.id === editingEndpoint.id ? newEndpoint : endpoint
      );
    } else {
      // Add new endpoint
      updatedEndpoints = [...endpoints, newEndpoint];
    }

    setEndpoints(updatedEndpoints);
    handleCloseForm();

    // If this is the first endpoint or we're editing the current endpoint,
    // set it as the current endpoint
    if (updatedEndpoints.length === 1 ||
        (currentEndpoint && currentEndpoint.id === newEndpoint.id)) {
      onEndpointChange(newEndpoint);
    }
  };

  const handleDeleteEndpoint = (endpointId: string) => {
    const updatedEndpoints = endpoints.filter(endpoint => endpoint.id !== endpointId);

    // If no endpoints left, create a new default one
    if (updatedEndpoints.length === 0) {
      const defaultEndpoint = { ...DEFAULT_ENDPOINT };
      setEndpoints([defaultEndpoint]);
      onEndpointChange(defaultEndpoint);
      localStorage.setItem(AI_ENDPOINTS_STORAGE_KEY, JSON.stringify(stripEndpointSecrets([defaultEndpoint])));
    } else {
      setEndpoints(updatedEndpoints);
      // If we're deleting the current endpoint, select another one
      if (currentEndpoint && currentEndpoint.id === endpointId) {
        onEndpointChange(updatedEndpoints[0]);
      }
      localStorage.setItem(AI_ENDPOINTS_STORAGE_KEY, JSON.stringify(stripEndpointSecrets(updatedEndpoints)));
    }

    handleCloseForm();
  };

  const handleEndpointSelect = (endpointId: string) => {
    const selectedEndpoint = endpoints.find(endpoint => endpoint.id === endpointId);
    if (selectedEndpoint) {
      onEndpointChange(selectedEndpoint);
    }
  };

  const confirmDelete = () => {
    if (editingEndpoint) {
      handleDeleteEndpoint(editingEndpoint.id);
    }
  };

  return (
    <div className="mb-4">
      {!isFormVisible ? (
        <>
          <div className="flex flex-col mb-2">
            <div className="flex items-center mb-2">
              <select
                className="flex-grow p-2 border rounded"
                value={currentEndpoint?.id || ''}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => handleEndpointSelect(e.target.value)}
                disabled={isLoading || endpoints.length === 0}
              >
                <option value="" disabled>
                  {isLoading ? 'Loading...' : 'Select AI endpoint'}
                </option>
                {endpoints.map((endpoint) => (
                  <option key={endpoint.id} value={endpoint.id}>
                    {endpoint.name}
                  </option>
                ))}
              </select>
            </div>
            {!compact && (
              <>
                <div className="flex space-x-2">
                  <Button
                    onClick={() => handleOpenForm()}
                    className="flex-1"
                  >
                    Add New
                  </Button>
                  <Button
                    onClick={() => currentEndpoint && handleOpenForm(currentEndpoint)}
                    disabled={!currentEndpoint}
                    className="flex-1"
                  >
                    Edit
                  </Button>
                </div>
                {currentEndpoint && (
                  <div className="text-xs text-muted-foreground mt-2">
                    <div>Name: {currentEndpoint.name}</div>
                    <div>URL: {currentEndpoint.url}</div>
                    {currentEndpoint.username && <div>Username: {currentEndpoint.username}</div>}
                  </div>
                )}
              </>
            )}
          </div>
        </>
      ) : (
        <div className="border rounded p-4 bg-gray-50">
          <h4 className="text-sm font-medium mb-3">
            {editingEndpoint ? 'Edit AI Endpoint' : 'Add AI Endpoint'}
          </h4>

          <div className="mb-3">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Name *
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormData({ ...formData, name: e.target.value })}
              placeholder="AI Server Name"
              className={`w-full p-2 border rounded ${errors.name ? 'border-red-500' : ''}`}
            />
            {errors.name && <p className="text-red-500 text-xs mt-1">{errors.name}</p>}
          </div>

          <div className="mb-3">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              URL *
            </label>
            <input
              type="text"
              value={formData.url}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormData({ ...formData, url: e.target.value })}
              placeholder="http://ai-server:8042"
              className={`w-full p-2 border rounded ${errors.url ? 'border-red-500' : ''}`}
            />
            {errors.url && <p className="text-red-500 text-xs mt-1">{errors.url}</p>}
          </div>

          <div className="mb-3">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Username (optional)
            </label>
            <input
              type="text"
              value={formData.username || ''}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormData({ ...formData, username: e.target.value })}
              placeholder="Username"
              className="w-full p-2 border rounded"
            />
          </div>

          <div className="mb-3">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Password (optional)
            </label>
            <input
              type="password"
              value={formData.password || ''}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormData({ ...formData, password: e.target.value })}
              placeholder="Password"
              className="w-full p-2 border rounded"
            />
          </div>

          <div className="flex justify-end space-x-2">
            {editingEndpoint && (
              <Button
                variant="destructive"
                onClick={() => {
                  setShowDeleteConfirmation(true);
                }}
              >
                Delete
              </Button>
            )}
            <Button
              onClick={handleCloseForm}
              variant="secondary"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
            >
              {editingEndpoint ? 'Update' : 'Add'}
            </Button>
          </div>

          <Dialog
            open={showDeleteConfirmation}
            onOpenChange={setShowDeleteConfirmation}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Confirm Delete</DialogTitle>
                <DialogDescription>
                  Are you sure you want to delete the endpoint "{editingEndpoint?.name}"? This action cannot be undone.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button
                  onClick={() => setShowDeleteConfirmation(false)}
                  className="mr-2"
                  variant="secondary"
                >
                  Cancel
                </Button>
                <Button
                  onClick={confirmDelete}
                  variant="destructive"
                >
                  Delete
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      )}
    </div>
  );
};

export default AIEndpointConfig;
