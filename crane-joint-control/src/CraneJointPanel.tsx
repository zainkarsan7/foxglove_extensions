import { PanelExtensionContext } from "@foxglove/extension";
import React, { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

const POSITION_TOPIC = "/joint_position_controller/commands";
const WHEEL_TOPIC = "/wheel_velocity_controller/commands";
const SCHEMA = "std_msgs/msg/Float64MultiArray";
const RPM_PRESETS = [0, 1000, 2000, 3000, 4000] as const;
const RPM_TO_RAD_S = (2 * Math.PI) / 60;

type ArrayMessage = { layout: { dim: never[]; data_offset: number }; data: number[] };
const arrayMessage = (data: number[]): ArrayMessage => ({ layout: { dim: [], data_offset: 0 }, data });
type Axis = { name: string; unit: string; min: number; max: number; step: number };
const AXES: Axis[] = [
  { name: "Swivel", unit: "rad", min: -3.14, max: 3.14, step: 0.01 },
  { name: "Left carriage", unit: "m", min: 0, max: 1, step: 0.005 },
  { name: "Right carriage", unit: "m", min: 0, max: 1, step: 0.005 },
  { name: "G0 gimbal", unit: "rad", min: -3.14, max: 3.14, step: 0.01 },
  { name: "G1 gimbal", unit: "rad", min: -3.14, max: 3.14, step: 0.01 },
];

function CranePanel({ context }: { context: PanelExtensionContext }): React.JSX.Element {
  const [positions, setPositions] = useState<number[]>([0, 0, 0, 0, 0]);
  const [jogSteps, setJogSteps] = useState<number[]>([0.01, 0.005, 0.005, 0.01, 0.01]);
  const [wheelRpm, setWheelRpm] = useState<number[]>([0, 0]);
  const [status, setStatus] = useState("Targets are local until you send them.");
  const available = context.advertise != undefined && context.publish != undefined;

  useEffect(() => {
    if (!context.advertise || !context.publish) return;
    context.advertise(POSITION_TOPIC, SCHEMA);
    context.advertise(WHEEL_TOPIC, SCHEMA);
    return () => {
      context.unadvertise?.(POSITION_TOPIC);
      context.unadvertise?.(WHEEL_TOPIC);
    };
  }, [context, available]);

  const publishPositions = useCallback((values: number[]) => {
    if (!context.publish) return;
    context.publish(POSITION_TOPIC, arrayMessage(values));
    setStatus(`Sent five-axis position target.`);
  }, [context]);

  const publishWheels = useCallback((values: number[]) => {
    if (!context.publish) return;
    context.publish(WHEEL_TOPIC, arrayMessage(values.map((rpm) => rpm * RPM_TO_RAD_S)));
    setStatus(`Requested wheel RPM: G0=${values[0]}, G1=${values[1]}.`);
  }, [context]);

  const updatePosition = (index: number, value: number) => {
    setPositions((previous) => previous.map((v, i) => i === index ? value : v));
  };
  const jog = (index: number, direction: -1 | 1) => {
    const axis = AXES[index]!;
    const next = positions.map((v, i) => i === index
      ? Math.max(axis.min, Math.min(axis.max, v + direction * jogSteps[index]!)) : v);
    setPositions(next);
    publishPositions(next);
  };
  const updateWheel = (index: number, rpm: number) => {
    const next = wheelRpm.map((v, i) => i === index ? rpm : v);
    setWheelRpm(next);
    publishWheels(next);
  };
  const buttonStyle: React.CSSProperties = { padding: "0.45rem 0.7rem", cursor: available ? "pointer" : "not-allowed" };

  return <div style={{ fontFamily: "sans-serif", padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
    <h2 style={{ margin: 0 }}>Crane manual control</h2>
    {!available && <strong>Publishing unavailable on this Foxglove connection.</strong>}
    <div style={{ fontSize: 12, opacity: 0.8 }}>Jogging sends a complete five-axis position target. Verify the initial targets before enabling motion.</div>
    <h3 style={{ marginBottom: 0 }}>Position axes</h3>
    {AXES.map((axis, index) => <div key={axis.name} style={{ border: "1px solid #7775", padding: 10, borderRadius: 6 }}>
      <label style={{ display: "block", marginBottom: 6 }}>{axis.name} ({axis.unit})</label>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <button disabled={!available} style={buttonStyle} onClick={() => jog(index, -1)}>− Jog</button>
        <input aria-label={`${axis.name} target`} type="number" min={axis.min} max={axis.max} step={axis.step}
          value={positions[index]} onChange={(e) => {
            const n = Number(e.target.value);
            if (e.target.value !== "" && Number.isFinite(n)) updatePosition(index, Math.max(axis.min, Math.min(axis.max, n)));
          }} style={{ width: 85 }} />
        <button disabled={!available} style={buttonStyle} onClick={() => jog(index, 1)}>+ Jog</button>
        <label>Jog size <input aria-label={`${axis.name} jog size`} type="number" min={0.0001} step={axis.step}
          value={jogSteps[index]} onChange={(e) => {
            const n = Number(e.target.value);
            if (n > 0 && Number.isFinite(n)) setJogSteps((old) => old.map((v, i) => i === index ? n : v));
          }} style={{ width: 72 }} /></label>
      </div>
    </div>)}
    <button disabled={!available} style={buttonStyle} onClick={() => publishPositions(positions)}>Send all five position targets</button>
    <h3 style={{ marginBottom: 0 }}>BLDC wheel groups</h3>
    {[0, 1].map((index) => <div key={index} style={{ border: "1px solid #7775", padding: 10, borderRadius: 6 }}>
      <div style={{ marginBottom: 8 }}>G{index} target: <strong>{wheelRpm[index]} RPM</strong> ({(wheelRpm[index]! * RPM_TO_RAD_S).toFixed(1)} rad/s)</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {RPM_PRESETS.map((rpm) => <button key={rpm} disabled={!available} style={{ ...buttonStyle, fontWeight: wheelRpm[index] === rpm ? "bold" : "normal" }}
          onClick={() => updateWheel(index, rpm)}>{rpm}</button>)}
      </div>
    </div>)}
    <button disabled={!available} style={{ ...buttonStyle, fontWeight: "bold" }} onClick={() => { setWheelRpm([0, 0]); publishWheels([0, 0]); }}>Command both wheel groups to 0 RPM</button>
    <small>RPM presets are target setpoints, not a timed acceleration ramp. A real ramp requires rate limiting in the controller/firmware.</small>
    <div role="status" style={{ fontSize: 12 }}>{status}</div>
    <code style={{ fontSize: 11, overflowWrap: "anywhere" }}>{POSITION_TOPIC}<br />{WHEEL_TOPIC}</code>
  </div>;
}

export function initCraneJointPanel(context: PanelExtensionContext): () => void {
  const root = createRoot(context.panelElement);
  root.render(<CranePanel context={context} />);
  return () => root.unmount();
}
