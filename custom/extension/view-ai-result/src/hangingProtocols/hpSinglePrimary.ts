/**
 * Custom hanging protocol for AI result viewing that:
 * 1. Only matches primary imaging display sets (excludes SR and SC)
 * 2. Forces single viewport layout initially
 * 3. Prevents automatic multi-viewport creation
 */
const hpSinglePrimary = {
  id: '@ohif/extension-view-ai-result.hpSinglePrimary',
  name: 'Single Primary Viewport',
  description: 'Single viewport showing only primary imaging data, excluding AI results and heatmaps',
  protocolMatchingRules: [
    {
      id: 'HasPrimaryImaging',
      weight: 100,
      attribute: 'numberOfDisplaySetsWithImages',
      constraint: {
        greaterThan: { value: 0 },
      },
    },
  ],
  toolGroupIds: ['default'],
  displaySetSelectors: {
    primaryDisplaySetId: {
      seriesMatchingRules: [
        // Only match display sets with frames (imaging data)
        {
          weight: 10,
          attribute: 'numImageFrames',
          constraint: {
            greaterThan: { value: 0 },
          },
          required: true,
        },
        // Exclude AI results (Structured Reports)
        {
          weight: -100,
          attribute: 'Modality',
          constraint: {
            equals: 'SR',
          },
        },
        // Exclude heatmaps (Secondary Capture)
        {
          weight: -100,
          attribute: 'Modality',
          constraint: {
            equals: 'SC',
          },
        },
        // Prefer display sets specified in URL
        {
          attribute: 'isDisplaySetFromUrl',
          weight: 20,
          constraint: {
            equals: true,
          },
        },
      ],
    },
  },
  defaultViewport: {
    viewportOptions: {
      viewportType: 'stack',
      toolGroupId: 'default',
      allowUnmatchedView: true,
      syncGroups: [
        {
          type: 'hydrateseg',
          id: 'sameFORId',
          source: true,
          target: true,
          options: {
            matchingRules: ['sameFOR'],
          },
        },
      ],
    },
    displaySets: [
      {
        id: 'primaryDisplaySetId',
        matchedDisplaySetsIndex: -1,
      },
    ],
  },
  stages: [
    {
      name: 'singlePrimary',
      viewportStructure: {
        layoutType: 'grid',
        properties: {
          rows: 1,
          columns: 1, // Force single viewport
        },
      },
      viewports: [
        {
          viewportOptions: {
            viewportType: 'stack',
            toolGroupId: 'default',
            allowUnmatchedView: true,
            initialImageOptions: {
              custom: 'sopInstanceLocation',
            },
            syncGroups: [
              {
                type: 'hydrateseg',
                id: 'sameFORId',
                source: true,
                target: true,
              },
            ],
          },
          displaySets: [
            {
              id: 'primaryDisplaySetId',
              // Only use the first matched primary display set
              matchedDisplaySetsIndex: 0,
            },
          ],
        },
      ],
    },
  ],
};

export default hpSinglePrimary;
