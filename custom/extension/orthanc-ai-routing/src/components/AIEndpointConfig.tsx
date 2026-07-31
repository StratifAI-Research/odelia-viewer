import React, { useState, useEffect, useRef } from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '@ohif/ui-next';
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

/** Persistence shape for endpoints: an explicit allow-list of fields to store. */
export type PersistedEndpoint = Pick<AIEndpoint, 'id' | 'name' | 'url'>;

/**
 * Return a persistence-safe copy of the endpoints, rebuilt from a known-safe
 * allow-list of fields. This is deliberately an allow-list (not `{ ...rest }`)
 * so that any field added to AIEndpoint later cannot silently leak into
 * localStorage.
 */
export const toPersistableEndpoints = (endpoints: AIEndpoint[]): PersistedEndpoint[] =>
  endpoints.map(({ id, name, url }) => ({ id, name, url }));

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
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);

  // Keep the latest currentEndpoint / onEndpointChange available to the
  // mount-load effect without listing them as dependencies. They were in its dep
  // array, and onEndpointChange is passed unmemoized from the parent, so the
  // effect re-ran on nearly every render — re-reading localStorage and calling
  // setEndpoints (which retriggers the save effect), constantly re-hydrating
  // in-memory state from storage.
  const currentEndpointRef = useRef(currentEndpoint);
  currentEndpointRef.current = currentEndpoint;
  const onEndpointChangeRef = useRef(onEndpointChange);
  onEndpointChangeRef.current = onEndpointChange;

  // Load endpoints from localStorage or config on component mount (once).
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
      localStorage.setItem(
        AI_ENDPOINTS_STORAGE_KEY,
        JSON.stringify(toPersistableEndpoints(loadedEndpoints))
      );
    }

    setEndpoints(loadedEndpoints);
    setIsLoading(false);

    // If no current endpoint is selected, select the first one
    if (!currentEndpointRef.current && loadedEndpoints.length > 0) {
      onEndpointChangeRef.current(loadedEndpoints[0]);
    }
    // Mount-only: read the latest currentEndpoint/onEndpointChange via refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Save endpoints to localStorage whenever they change
  useEffect(() => {
    if (endpoints.length > 0) {
      localStorage.setItem(
        AI_ENDPOINTS_STORAGE_KEY,
        JSON.stringify(toPersistableEndpoints(endpoints))
      );
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
    if (
      updatedEndpoints.length === 1 ||
      (currentEndpoint && currentEndpoint.id === newEndpoint.id)
    ) {
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
      localStorage.setItem(
        AI_ENDPOINTS_STORAGE_KEY,
        JSON.stringify(toPersistableEndpoints([defaultEndpoint]))
      );
    } else {
      setEndpoints(updatedEndpoints);
      // If we're deleting the current endpoint, select another one
      if (currentEndpoint && currentEndpoint.id === endpointId) {
        onEndpointChange(updatedEndpoints[0]);
      }
      localStorage.setItem(
        AI_ENDPOINTS_STORAGE_KEY,
        JSON.stringify(toPersistableEndpoints(updatedEndpoints))
      );
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
          <div className="mb-2 flex flex-col">
            <div className="mb-2 flex items-center">
              <select
                // Both call sites sit on a dark panel; without an explicit
                // colour the native control renders as a bright white slab.
                className="flex-grow rounded border border-gray-700 bg-gray-800 p-2 text-white"
                value={currentEndpoint?.id || ''}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                  handleEndpointSelect(e.target.value)
                }
                disabled={isLoading || endpoints.length === 0}
              >
                <option
                  value=""
                  disabled
                >
                  {isLoading ? 'Loading...' : 'Select AI endpoint'}
                </option>
                {endpoints.map(endpoint => (
                  <option
                    key={endpoint.id}
                    value={endpoint.id}
                  >
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
                  <div className="text-muted-foreground mt-2 text-xs">
                    <div>Name: {currentEndpoint.name}</div>
                    <div>URL: {currentEndpoint.url}</div>
                  </div>
                )}
              </>
            )}
          </div>
        </>
      ) : (
        // Light card: the labels below are `text-gray-700` and the native
        // inputs are white, so the surface has to be light too. `gray-50` is
        // not in OHIF's palette (it starts at 100) — that class emitted no rule
        // at all, which left dark labels on a dark panel.
        <div className="rounded border bg-gray-100 p-4">
          <h4 className="mb-3 text-sm font-medium">
            {editingEndpoint ? 'Edit AI Endpoint' : 'Add AI Endpoint'}
          </h4>

          <div className="mb-3">
            <label className="mb-1 block text-sm font-medium text-gray-700">Name *</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setFormData({ ...formData, name: e.target.value })
              }
              placeholder="AI Server Name"
              className={`w-full rounded border p-2 ${errors.name ? 'border-red-500' : ''}`}
            />
            {errors.name && <p className="mt-1 text-xs text-red-500">{errors.name}</p>}
          </div>

          <div className="mb-3">
            <label className="mb-1 block text-sm font-medium text-gray-700">URL *</label>
            <input
              type="text"
              value={formData.url}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setFormData({ ...formData, url: e.target.value })
              }
              placeholder="http://ai-server:8042"
              className={`w-full rounded border p-2 ${errors.url ? 'border-red-500' : ''}`}
            />
            {errors.url && <p className="mt-1 text-xs text-red-500">{errors.url}</p>}
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
            <Button onClick={handleSubmit}>{editingEndpoint ? 'Update' : 'Add'}</Button>
          </div>

          <Dialog
            open={showDeleteConfirmation}
            onOpenChange={setShowDeleteConfirmation}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Confirm Delete</DialogTitle>
                <DialogDescription>
                  Are you sure you want to delete the endpoint &quot;{editingEndpoint?.name}&quot;? This
                  action cannot be undone.
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
