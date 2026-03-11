import React, { useState } from 'react';
import { Icons } from '@ohif/ui-next';
import { useChatService } from 'view-ai-result/src/hooks/useChatService';

// this is a debug component that is used to list various things that might
// be useful for debugging such as cross origin errors, etc.
function Debug() {
  const { sessionId, isConnected, connect, disconnect, clearHistory } = useChatService();
  const [isRestarting, setIsRestarting] = useState(false);

  const handleStartNewSession = async () => {
    setIsRestarting(true);
    try {
      disconnect();
      clearHistory();
      await connect();
    } finally {
      setIsRestarting(false);
    }
  };

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <div className="flex h-screen w-screen items-center justify-center">
        <div className="bg-secondary-dark mx-auto space-y-4 rounded-lg py-8 px-8 drop-shadow-md">
          <img
            className="mx-auto block h-14"
            src="./ohif-logo.svg"
            alt="OHIF"
          />
          <div className="space-y-4 pt-4 text-center">
            <div className="flex flex-col items-center justify-center">
              <p className="text-primary-active mt-4 text-xl font-semibold">Debug Information</p>
              <div className="mt-4 flex items-center space-x-2">
                <p className="text-md text-white">Cross Origin Isolated (COOP/COEP)</p>
                <Icons.ByName
                  name={
                    window.crossOriginIsolated ? 'notifications-success' : 'notifications-error'
                  }
                  className="h-5 w-5"
                />
              </div>
            </div>

            <div className="mt-6 rounded-md border border-gray-700 bg-black/40 p-4 text-left">
              <p className="text-md mb-2 font-semibold text-white">AI Chat Session</p>
              <p className="text-xs mb-2 text-gray-300">
                Status:{' '}
                {isConnected
                  ? `Connected (session: ${sessionId ? sessionId.slice(0, 8) : 'n/a'}...)`
                  : 'Disconnected'}
              </p>
              <button
                type="button"
                onClick={handleStartNewSession}
                disabled={isRestarting}
                className="mt-2 rounded bg-primary-main px-3 py-2 text-xs font-medium text-white hover:bg-primary-light disabled:opacity-50"
              >
                {isRestarting ? 'Starting new session...' : 'Start New Chat Session'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Debug;
