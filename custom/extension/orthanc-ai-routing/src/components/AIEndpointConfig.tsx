import React, { useState, useEffect, useRef } from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@ohif/ui-next';
import {
  AI_ENDPOINTS_STORAGE_KEY,
  DEFAULT_AI_ENDPOINT_NAME,
  DEFAULT_AI_ENDPOINT_URL,
} from '../constants';
import { AI_ENDPOINTS_CONFIG_BASE_KEY, reconcileEndpoints } from '../utils/reconcileEndpoints';

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

/**
 * Read an endpoint array out of localStorage, or null when the key is absent or
 * unusable. Null and `[]` are distinct for the config base: absent means "never
 * reconciled", empty means "config declared nothing last time".
 */
const readEndpoints = (key: string): AIEndpoint[] | null => {
  const raw = localStorage.getItem(key);
  if (raw === null) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch (error) {
    console.error(`Failed to parse ${key} from localStorage:`, error);
    return null;
  }
};

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

  // Load endpoints on mount, merging any change made to the deployment config
  // into what is already stored. See reconcileEndpoints for why this is a
  // three-way merge rather than "whichever side we read first wins".
  useEffect(() => {
    const stored = readEndpoints(AI_ENDPOINTS_STORAGE_KEY) ?? [];
    const base = readEndpoints(AI_ENDPOINTS_CONFIG_BASE_KEY);
    const config: AIEndpoint[] = (window as any).config?.aiEndpoints || [];

    const merged = reconcileEndpoints({ stored, config, base });
    // Nothing stored and nothing configured — fall back to the built-in.
    const loadedEndpoints = merged.length > 0 ? merged : [DEFAULT_ENDPOINT];

    localStorage.setItem(
      AI_ENDPOINTS_STORAGE_KEY,
      JSON.stringify(toPersistableEndpoints(loadedEndpoints))
    );
    // Record what config said this time, so the next load can tell a config
    // change apart from a user edit.
    localStorage.setItem(
      AI_ENDPOINTS_CONFIG_BASE_KEY,
      JSON.stringify(toPersistableEndpoints(config))
    );

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
              <Select
                value={currentEndpoint?.id || ''}
                onValueChange={handleEndpointSelect}
                disabled={isLoading || endpoints.length === 0}
              >
                <SelectTrigger aria-label="AI endpoint">
                  <SelectValue placeholder={isLoading ? 'Loading…' : 'Select AI endpoint'} />
                </SelectTrigger>
                <SelectContent>
                  {/* Radix throws on an empty item value; endpoint ids come from
                      localStorage / window.config, so a malformed entry must not
                      take the whole panel down with it. */}
                  {endpoints
                    .filter(endpoint => endpoint.id)
                    .map(endpoint => (
                      <SelectItem
                        key={endpoint.id}
                        value={endpoint.id}
                      >
                        {endpoint.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
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
        <div className="border-input bg-popover rounded border p-3">
          <h4 className="text-foreground mb-3 text-base font-medium">
            {editingEndpoint ? 'Edit AI Endpoint' : 'Add AI Endpoint'}
          </h4>

          <div className="mb-3 flex flex-col space-y-1">
            <Label htmlFor="ai-endpoint-name">Name *</Label>
            <Input
              id="ai-endpoint-name"
              value={formData.name}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setFormData({ ...formData, name: e.target.value })
              }
              placeholder="AI Server Name"
              className={errors.name ? 'border-red-500' : ''}
            />
            {errors.name && <p className="text-xs text-red-500">{errors.name}</p>}
          </div>

          <div className="mb-3 flex flex-col space-y-1">
            <Label htmlFor="ai-endpoint-url">URL *</Label>
            <Input
              id="ai-endpoint-url"
              value={formData.url}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setFormData({ ...formData, url: e.target.value })
              }
              placeholder="http://ai-server:8042"
              className={errors.url ? 'border-red-500' : ''}
            />
            {errors.url && <p className="text-xs text-red-500">{errors.url}</p>}
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
                {/*
                  DialogDescription carries no colour of its own and the dialog is
                  portalled onto <body>, which only sets a background — so without
                  an explicit token it inherits the browser default (black) and is
                  unreadable on the dark `bg-muted` card.
                */}
                <DialogDescription className="text-foreground">
                  Are you sure you want to delete the endpoint &quot;{editingEndpoint?.name}&quot;?
                  This action cannot be undone.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button
                  onClick={() => setShowDeleteConfirmation(false)}
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
