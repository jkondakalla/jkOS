import { Led, LabelTape, VuMeter, Knob, Vent } from './hardware';

export interface RailMetrics {
  cpu: number;
  mem: number;
  net: number;
  dsk: number;
}

interface RightRailProps {
  rail?: RailMetrics;
}

const DEFAULT_RAIL: RailMetrics = { cpu: 0, mem: 0, net: 0, dsk: 0 };

export default function RightRail({ rail = DEFAULT_RAIL }: RightRailProps) {
  return (
    <aside style={{
      width: 'var(--hub-rail-w)',
      background: 'linear-gradient(270deg, var(--hub-bg-2), var(--hub-bg-1))',
      borderLeft: '1px solid var(--hub-line-strong)',
      flexShrink: 0,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      padding: '12px 0',
      gap: 14,
      position: 'relative',
    }}>
      <LabelTape style={{ fontSize: 8 }}>I/O</LabelTape>

      <div style={{ display: 'flex', gap: 6 }}>
        <VuMeter value={rail.cpu} label="CPU" height={84} width={11} />
        <VuMeter value={rail.mem} label="MEM" height={84} width={11} />
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <VuMeter value={rail.net} label="NET" height={84} width={11} />
        <VuMeter value={rail.dsk} label="DSK" height={84} width={11} />
      </div>

      <span style={{ flex: 1 }} />

      <Knob value={0.4} size={28} label="GAIN" />
      <Knob value={0.6} size={28} label="TONE" />

      <Vent slats={3} width={36} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center', paddingBottom: 6 }}>
        <Led color="green" size="sm" />
        <Led color="amber" size="sm" />
        <Led color="red" size="sm" steady />
      </div>
    </aside>
  );
}
