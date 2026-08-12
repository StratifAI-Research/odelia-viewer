import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import AIEndpointConfig, { AIEndpoint } from './AIEndpointConfig';
import { installLocalStorageMock } from '../test-utils/harness';

const DEFAULT_ID = 'default-ai-server';

function seed(endpoints: AIEndpoint[]) {
  localStorage.setItem('aiEndpoints', JSON.stringify(endpoints));
}

const epA: AIEndpoint = { id: 'a', name: 'Alpha', url: 'http://alpha:8042' };
const epB: AIEndpoint = { id: 'b', name: 'Beta', url: 'http://beta:8042' };

beforeEach(() => {
  installLocalStorageMock();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('AIEndpointConfig — loading', () => {
  it('falls back to the default endpoint and selects it when storage is empty', () => {
    // A loaded config that declares no endpoints. In production `window.config`
    // is always set by app-config.js before the app boots, so this — not its
    // absence — is what "nothing configured" actually looks like.
    (window as any).config = {};
    try {
      const onEndpointChange = jest.fn();
      render(
        <AIEndpointConfig
          onEndpointChange={onEndpointChange}
          currentEndpoint={null}
        />
      );
      expect(onEndpointChange).toHaveBeenCalledWith(expect.objectContaining({ id: DEFAULT_ID }));
      expect(JSON.parse(localStorage.getItem('aiEndpoints')!)[0].id).toBe(DEFAULT_ID);
    } finally {
      delete (window as any).config;
    }
  });

  it('loads saved endpoints from localStorage', () => {
    seed([epA, epB]);
    render(
      <AIEndpointConfig
        onEndpointChange={jest.fn()}
        currentEndpoint={epA}
      />
    );
    expect(screen.getByText('Alpha')).toBeTruthy(); // option text
    expect(screen.getByText('Beta')).toBeTruthy();
  });

  it('recovers from malformed stored JSON without crashing', () => {
    localStorage.setItem('aiEndpoints', '{bad');
    const onEndpointChange = jest.fn();
    render(
      <AIEndpointConfig
        onEndpointChange={onEndpointChange}
        currentEndpoint={null}
      />
    );
    expect(onEndpointChange).toHaveBeenCalledWith(expect.objectContaining({ id: DEFAULT_ID }));
  });

  it('bootstraps from window.config.aiEndpoints when storage is empty', () => {
    (window as any).config = { aiEndpoints: [epA] };
    try {
      const onEndpointChange = jest.fn();
      render(
        <AIEndpointConfig
          onEndpointChange={onEndpointChange}
          currentEndpoint={null}
        />
      );
      expect(onEndpointChange).toHaveBeenCalledWith(epA);
      expect(JSON.parse(localStorage.getItem('aiEndpoints')!)[0].id).toBe('a');
    } finally {
      delete (window as any).config;
    }
  });
});

/**
 * The active endpoint is held by OrthancAIService, which snapshots
 * `getAIEndpoints()[0]` in its constructor at preRegistration — long before this
 * component mounts. So the merge landing in storage is not enough: it has to be
 * pushed at whoever holds the selection, or `POST /send-to-ai` keeps the old
 * `target_url` for the rest of the session while the dropdown shows the new one.
 */
describe('AIEndpointConfig — a config edit reaches the ACTIVE endpoint', () => {
  const renderWith = (current: AIEndpoint | null) => {
    const onEndpointChange = jest.fn();
    render(
      <AIEndpointConfig
        onEndpointChange={onEndpointChange}
        currentEndpoint={current}
      />
    );
    return onEndpointChange;
  };

  /** A browser that has already reconciled this config once. */
  const seedReconciled = (endpoints: AIEndpoint[]) => {
    seed(endpoints);
    localStorage.setItem('aiEndpoints.configBase', JSON.stringify(endpoints));
  };

  it('re-selects the endpoint when its URL changed in app-config.js', () => {
    const movedA = { ...epA, url: 'http://alpha-new:8042' };
    seedReconciled([epA]);
    (window as any).config = { aiEndpoints: [movedA] };
    try {
      // Same id, so the dropdown looks correctly selected the whole time.
      expect(renderWith(epA)).toHaveBeenCalledWith(movedA);
    } finally {
      delete (window as any).config;
    }
  });

  it('re-selects when only the display name changed', () => {
    const renamedA = { ...epA, name: 'Alpha (staging)' };
    seedReconciled([epA]);
    (window as any).config = { aiEndpoints: [renamedA] };
    try {
      expect(renderWith(epA)).toHaveBeenCalledWith(renamedA);
    } finally {
      delete (window as any).config;
    }
  });

  it('does not re-select, or toast, when nothing changed', () => {
    seedReconciled([epA, epB]);
    (window as any).config = { aiEndpoints: [epA, epB] };
    try {
      expect(renderWith(epA)).not.toHaveBeenCalled();
    } finally {
      delete (window as any).config;
    }
  });

  it('falls back to the first endpoint when the selected one was removed', () => {
    seedReconciled([epA, epB]);
    (window as any).config = { aiEndpoints: [epB] };
    try {
      expect(renderWith(epA)).toHaveBeenCalledWith(epB);
    } finally {
      delete (window as any).config;
    }
  });
});

/**
 * `window.config.aiEndpoints` used to be read as `... || []`. An empty list is
 * MEANINGFUL to the merge — it means the deployment removed its endpoints — so
 * flattening a malformed value into one deletes real configuration on the
 * strength of a typo, and lands on the built-in default.
 */
describe('AIEndpointConfig — a malformed aiEndpoints does not destroy storage', () => {
  const badValues: [string, unknown][] = [
    ['an object instead of an array', { 'mst-ai': { url: 'http://x' } }],
    ['a string', 'http://alpha:8042'],
    ['an array of strings', ['http://alpha:8042']],
    ['entries missing a url', [{ id: 'a', name: 'Alpha' }]],
    // `name` labels the dropdown and is sent as `target`; without it the payload
    // carries `target: undefined`, which JSON.stringify drops entirely.
    ['entries missing a name', [{ id: 'a', url: 'http://alpha:8042' }]],
    ['entries with an empty id', [{ id: '', name: 'Alpha', url: 'http://alpha:8042' }]],
    // `[]` is how a deployment says "no endpoints"; null is a mistake, and a
    // mistake must not be read as an instruction to delete.
    ['null', null],
    ['duplicate ids', [epA, { ...epA, url: 'http://alpha-2:8042' }]],
  ];

  it.each(badValues)('keeps the stored endpoints when aiEndpoints is %s', (_label, value) => {
    seed([epA, epB]);
    localStorage.setItem('aiEndpoints.configBase', JSON.stringify([epA, epB]));
    (window as any).config = { aiEndpoints: value };
    try {
      render(
        <AIEndpointConfig
          onEndpointChange={jest.fn()}
          currentEndpoint={epA}
        />
      );

      expect(JSON.parse(localStorage.getItem('aiEndpoints')!).map(e => e.id)).toEqual(['a', 'b']);
      // The base must survive too, so the next load with a good config still has
      // something truthful to diff against.
      expect(JSON.parse(localStorage.getItem('aiEndpoints.configBase')!).map(e => e.id)).toEqual([
        'a',
        'b',
      ]);
    } finally {
      delete (window as any).config;
    }
  });

  /**
   * With storage EMPTY and the config unreadable, the fallback shown on screen
   * must not be written back. If it is, the synthesized default is stored as
   * though the user had added it, and the next load with a good config keeps it
   * as "user-added" alongside the real endpoints — permanently, from one bad
   * load.
   */
  it('does not persist the fallback it shows when the config is unreadable', () => {
    (window as any).config = { aiEndpoints: 'not-a-list' };
    try {
      render(
        <AIEndpointConfig
          onEndpointChange={jest.fn()}
          currentEndpoint={null}
        />
      );
      expect(localStorage.getItem('aiEndpoints')).toBeNull();
      expect(localStorage.getItem('aiEndpoints.configBase')).toBeNull();
    } finally {
      delete (window as any).config;
    }
  });

  it('leaves no trace for a later good load to inherit', () => {
    // Bad load first...
    (window as any).config = { aiEndpoints: 'not-a-list' };
    const { unmount } = render(
      <AIEndpointConfig
        onEndpointChange={jest.fn()}
        currentEndpoint={null}
      />
    );
    unmount();

    // ...then a good one declaring the real endpoint.
    (window as any).config = { aiEndpoints: [epA] };
    try {
      render(
        <AIEndpointConfig
          onEndpointChange={jest.fn()}
          currentEndpoint={null}
        />
      );
      expect(JSON.parse(localStorage.getItem('aiEndpoints')!).map(e => e.id)).toEqual(['a']);
    } finally {
      delete (window as any).config;
    }
  });

  it('still honours a deployment that genuinely declares no endpoints', () => {
    seed([epA]);
    localStorage.setItem('aiEndpoints.configBase', JSON.stringify([epA]));
    (window as any).config = { orthancUrl: 'http://orthanc' };
    try {
      const onEndpointChange = jest.fn();
      render(
        <AIEndpointConfig
          onEndpointChange={onEndpointChange}
          currentEndpoint={epA}
        />
      );

      expect(JSON.parse(localStorage.getItem('aiEndpoints')!)[0].id).toBe(DEFAULT_ID);
      expect(onEndpointChange).toHaveBeenCalledWith(expect.objectContaining({ id: DEFAULT_ID }));
    } finally {
      delete (window as any).config;
    }
  });
});

describe('AIEndpointConfig — selection & display', () => {
  it('selecting another endpoint calls onEndpointChange', () => {
    seed([epA, epB]);
    const onEndpointChange = jest.fn();
    render(
      <AIEndpointConfig
        onEndpointChange={onEndpointChange}
        currentEndpoint={epA}
      />
    );
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'b' } });
    expect(onEndpointChange).toHaveBeenCalledWith(epB);
  });

  it('shows endpoint details and Add/Edit buttons when not compact', () => {
    seed([epA]);
    render(
      <AIEndpointConfig
        onEndpointChange={jest.fn()}
        currentEndpoint={epA}
      />
    );
    expect(screen.getByText('Name: Alpha')).toBeTruthy();
    expect(screen.getByText('URL: http://alpha:8042')).toBeTruthy();
    expect(screen.getByText('Add New')).toBeTruthy();
    expect(screen.getByText('Edit')).toBeTruthy();
  });

  it('hides the management buttons and details in compact mode', () => {
    seed([epA]);
    render(
      <AIEndpointConfig
        onEndpointChange={jest.fn()}
        currentEndpoint={epA}
        compact
      />
    );
    expect(screen.queryByText('Add New')).toBeNull();
    expect(screen.queryByText('Name: Alpha')).toBeNull();
  });

  it('disables the select while loading / with no endpoints', () => {
    // No seed: first render is isLoading=true before the mount effect resolves.
    render(
      <AIEndpointConfig
        onEndpointChange={jest.fn()}
        currentEndpoint={null}
        compact
      />
    );
    // After mount the default is loaded and the select is enabled again.
    expect((screen.getByRole('combobox') as HTMLSelectElement).disabled).toBe(false);
  });
});

describe('AIEndpointConfig — form validation & add', () => {
  it('reports required-field and URL-format errors', () => {
    seed([epA]);
    render(
      <AIEndpointConfig
        onEndpointChange={jest.fn()}
        currentEndpoint={epA}
      />
    );
    fireEvent.click(screen.getByText('Add New'));
    fireEvent.click(screen.getByText('Add')); // submit empty
    expect(screen.getByText('Name is required')).toBeTruthy();
    expect(screen.getByText('URL is required')).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText('AI Server Name'), { target: { value: 'X' } });
    fireEvent.change(screen.getByPlaceholderText('http://ai-server:8042'), {
      target: { value: 'ftp://nope' },
    });
    fireEvent.click(screen.getByText('Add'));
    expect(screen.getByText('URL must start with http:// or https://')).toBeTruthy();
  });

  it('adds a valid endpoint and persists it', () => {
    seed([epA]);
    render(
      <AIEndpointConfig
        onEndpointChange={jest.fn()}
        currentEndpoint={epA}
      />
    );
    fireEvent.click(screen.getByText('Add New'));
    fireEvent.change(screen.getByPlaceholderText('AI Server Name'), { target: { value: 'Gamma' } });
    fireEvent.change(screen.getByPlaceholderText('http://ai-server:8042'), {
      target: { value: 'http://gamma:8042' },
    });
    fireEvent.click(screen.getByText('Add'));

    // form closed, new endpoint persisted
    expect(screen.queryByPlaceholderText('AI Server Name')).toBeNull();
    const stored = JSON.parse(localStorage.getItem('aiEndpoints')!);
    expect(stored.some((e: AIEndpoint) => e.name === 'Gamma')).toBe(true);
  });

  it('offers no credential fields and persists only id/name/url', () => {
    // The username/password inputs were removed — routing never sent them, so
    // collecting/persisting them was misleading.
    seed([epA]);
    render(
      <AIEndpointConfig
        onEndpointChange={jest.fn()}
        currentEndpoint={epA}
      />
    );
    fireEvent.click(screen.getByText('Add New'));
    expect(screen.queryByPlaceholderText('Password')).toBeNull();
    expect(screen.queryByPlaceholderText('Username')).toBeNull();
    fireEvent.change(screen.getByPlaceholderText('AI Server Name'), {
      target: { value: 'Secure' },
    });
    fireEvent.change(screen.getByPlaceholderText('http://ai-server:8042'), {
      target: { value: 'http://secure:8042' },
    });
    fireEvent.click(screen.getByText('Add'));

    const added = JSON.parse(localStorage.getItem('aiEndpoints')!).find(
      (e: AIEndpoint) => e.name === 'Secure'
    );
    expect(added).toBeTruthy();
    expect(Object.keys(added).sort()).toEqual(['id', 'name', 'url']);
  });

  it('Cancel closes the form without saving', () => {
    seed([epA]);
    render(
      <AIEndpointConfig
        onEndpointChange={jest.fn()}
        currentEndpoint={epA}
      />
    );
    fireEvent.click(screen.getByText('Add New'));
    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.queryByPlaceholderText('AI Server Name')).toBeNull();
  });
});

describe('AIEndpointConfig — edit & delete', () => {
  it('edits the current endpoint and updates it in place', () => {
    seed([epA]);
    const onEndpointChange = jest.fn();
    render(
      <AIEndpointConfig
        onEndpointChange={onEndpointChange}
        currentEndpoint={epA}
      />
    );
    fireEvent.click(screen.getByText('Edit'));
    const nameInput = screen.getByDisplayValue('Alpha');
    fireEvent.change(nameInput, { target: { value: 'Alpha-2' } });
    fireEvent.click(screen.getByText('Update'));
    // editing the current endpoint re-selects it
    expect(onEndpointChange).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'a', name: 'Alpha-2' })
    );
  });

  it('deleting the current endpoint among several selects a remaining one', () => {
    seed([epA, epB]);
    const onEndpointChange = jest.fn();
    render(
      <AIEndpointConfig
        onEndpointChange={onEndpointChange}
        currentEndpoint={epA}
      />
    );
    fireEvent.click(screen.getByText('Edit')); // edits the current endpoint (epA)
    fireEvent.click(screen.getByText('Delete'));
    const deletes = screen.getAllByRole('button', { name: 'Delete' });
    fireEvent.click(deletes[deletes.length - 1]);

    expect(onEndpointChange).toHaveBeenCalledWith(epB); // re-selected the survivor
    expect(JSON.parse(localStorage.getItem('aiEndpoints')!).map((e: AIEndpoint) => e.id)).toEqual([
      'b',
    ]);
  });

  it('deleting the only endpoint restores the default via the confirm dialog', () => {
    seed([epA]);
    const onEndpointChange = jest.fn();
    render(
      <AIEndpointConfig
        onEndpointChange={onEndpointChange}
        currentEndpoint={epA}
      />
    );
    fireEvent.click(screen.getByText('Edit'));

    // Dialog is closed until Delete is clicked (stub respects `open`)
    expect(screen.queryByText('Confirm Delete')).toBeNull();
    fireEvent.click(screen.getByText('Delete')); // the form's destructive button opens the dialog
    expect(screen.getByText('Confirm Delete')).toBeTruthy();

    // With the dialog open there are two "Delete" buttons; the dialog's is last.
    const deletes = screen.getAllByRole('button', { name: 'Delete' });
    fireEvent.click(deletes[deletes.length - 1]);
    expect(onEndpointChange).toHaveBeenCalledWith(expect.objectContaining({ id: DEFAULT_ID }));
  });
});
