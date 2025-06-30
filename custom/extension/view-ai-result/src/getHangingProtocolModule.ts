import hpSinglePrimary from './hangingProtocols/hpSinglePrimary';

function getHangingProtocolModule() {
  return [
    {
      name: hpSinglePrimary.id,
      protocol: hpSinglePrimary,
    },
  ];
}

export default getHangingProtocolModule;
