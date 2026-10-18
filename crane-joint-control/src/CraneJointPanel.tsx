import type { PanelExtensionContext } from "@foxglove/extension";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./CraneJointPanel.css";

const POSITION_TOPIC = "/joint_position_controller/commands";
const WHEEL_TOPIC = "/wheel_velocity_controller/commands";
const JOINT_STATES_TOPIC = "/joint_states";
const ARRAY_SCHEMA = "std_msgs/msg/Float64MultiArray";
const RPM_PRESETS = [0, 1000, 2000, 3000, 4000] as const;
const JOINTS = [
  { name: "swivel_joint", label: "Swivel", unit: "rad", min: -3.14, max: 3.14, jog: 0.01 },
  { name: "LG_lin_joint", label: "Left carriage", unit: "m", min: -0.5, max: 0, jog: 0.005 },
  { name: "RG_lin_joint", label: "Right carriage", unit: "m", min: 0, max: 0.5, jog: 0.005 },
  { name: "G0_joint", label: "Gimbal 0", unit: "rad", min: -1.57, max: 1.57, jog: 0.01 },
  { name: "G1_joint", label: "Gimbal 1", unit: "rad", min: -1.57, max: 1.57, jog: 0.01 },
] as const;

type ArrayMessage = { layout: { dim: never[]; data_offset: number }; data: number[] };
type JointState = { name?: string[]; position?: number[]; velocity?: number[] };
type Pair = [number, number];
const clamp = (x: number, min: number, max: number) => Math.min(max, Math.max(min, x));
const arrayMessage = (data: number[]): ArrayMessage => ({ layout: { dim: [], data_offset: 0 }, data });
const rpmToRadSec = (rpm: number) => (rpm * Math.PI * 2) / 60;

function CranePanel({ context }: { context: PanelExtensionContext }): React.JSX.Element {
  const [targets, setTargets] = useState<number[]>(JOINTS.map(() => 0));
  const [actual, setActual] = useState<(number | undefined)[]>(JOINTS.map(() => undefined));
  const [rpm, setRpm] = useState<Pair>([0, 0]);
  const [feedbackReceived, setFeedbackReceived] = useState(false);
  const [armed, setArmed] = useState(false);
  const [jogSteps, setJogSteps] = useState<number[]>(JOINTS.map((j) => j.jog));
  const [status, setStatus] = useState("Waiting for joint feedback");
  const [publishingAvailable, setPublishingAvailable] = useState(Boolean(context.publish && context.advertise));
  const [jointOpen, setJointOpen] = useState(true);
  const [wheelOpen, setWheelOpen] = useState(true);
  const targetsRef = useRef(targets);
  const actualRef = useRef(actual);
  const armedRef = useRef(armed);
  const rpmRef = useRef(rpm);
  const feedbackRef = useRef(false);
  const publishReady = publishingAvailable && armed && feedbackReceived;

  const updateTargets = useCallback((next: number[]) => {
    targetsRef.current = next;
    setTargets(next);
  }, []);

  useEffect(() => {
    if (!context.advertise || !context.publish) {
      setPublishingAvailable(false);
      return;
    }
    context.advertise(POSITION_TOPIC, ARRAY_SCHEMA);
    context.advertise(WHEEL_TOPIC, ARRAY_SCHEMA);
    setPublishingAvailable(true);
    return () => {
      context.unadvertise?.(POSITION_TOPIC);
      context.unadvertise?.(WHEEL_TOPIC);
    };
  }, [context]);

  useEffect(() => {
    // Let the installed Foxglove SDK infer its readonly RenderState type.
    context.onRender = (renderState, done) => {
      for (const event of renderState.currentFrame ?? []) {
        if (event.topic !== JOINT_STATES_TOPIC) continue;
        const msg = event.message as JointState;
        if (!Array.isArray(msg.name) || !Array.isArray(msg.position)) continue;
        const next = JOINTS.map((joint) => {
          const index = msg.name!.indexOf(joint.name);
          const value = index >= 0 ? msg.position![index] : undefined;
          return typeof value === "number" && Number.isFinite(value) ? value : undefined;
        });
        actualRef.current = next;
        setActual(next);
        const complete = next.every((v) => v !== undefined);
        feedbackRef.current = complete;
        setFeedbackReceived(complete);
        if (!armedRef.current && complete) updateTargets(next as number[]);
      }
      done();
    };
    context.watch("currentFrame");
    context.subscribe([{ topic: JOINT_STATES_TOPIC }]);
    return () => {
      context.unsubscribeAll();
      context.onRender = undefined;
    };
  }, [context, updateTargets]);

  const sendPositions = useCallback((values: number[]) => {
    if (!context.publish || !armedRef.current || !feedbackRef.current) return;
    if (values.length !== JOINTS.length || !values.every(Number.isFinite)) return;
    context.publish(POSITION_TOPIC, arrayMessage(values));
    setStatus("Position target sent");
  }, [context]);

  const setJointTarget = (index: number, value: number) => {
    if (!Number.isFinite(value)) return;
    const next = [...targetsRef.current];
    const joint = JOINTS[index]!;
    next[index] = clamp(value, joint.min, joint.max);
    updateTargets(next);
  };

  const jog = (index: number, direction: number) => {
    if (!publishReady) return;
    const next = actualRef.current.map((value, i) => {
      const joint = JOINTS[i]!;
      const base = value!;
      return i === index ? clamp(base + direction * jogSteps[i]!, joint.min, joint.max) : base;
    });
    updateTargets(next);
    sendPositions(next);
  };

  const sendWheelTargets = (next: Pair) => {
    if (!context.publish || !armedRef.current || !feedbackRef.current) return;
    context.publish(WHEEL_TOPIC, arrayMessage(next.map(rpmToRadSec)));
    rpmRef.current = next;
    setRpm(next);
    setStatus(`Wheel target sent: G0 ${next[0]}, G1 ${next[1]} RPM`);
  };

  const zeroWheels = () => {
    if (!context.publish || !publishingAvailable) return;
    context.publish(WHEEL_TOPIC, arrayMessage([0, 0]));
    rpmRef.current = [0, 0];
    setRpm([0, 0]);
    setStatus("Zero wheel target sent");
  };

  const disarm = () => {
    if (armedRef.current) zeroWheels();
    armedRef.current = false;
    setArmed(false);
    setStatus("UI disarmed. Zero wheel target attempted; this is not an emergency stop.");
  };

  return (
    <div className="crane-panel">
      <header className="crane-header">
        <div><h2>Crane manual control</h2><small>Five axes · two wheel groups</small></div>
        <span className={`crane-pill ${publishReady ? "ready" : ""}`}>{publishReady ? "ARMED" : "DISARMED"}</span>
      </header>
      {!publishingAvailable && <p className="crane-warning">Connection does not support publishing.</p>}
      {!feedbackReceived && <p className="crane-warning">Waiting for all five positions on /joint_states. Jogging is disabled until feedback arrives.</p>}
      <div className="crane-armbar">
        <label><input type="checkbox" checked={armed} disabled={!publishingAvailable || !feedbackReceived} onChange={(e) => {
          if (e.target.checked) {
            armedRef.current = true;
            setArmed(true);
            updateTargets(actualRef.current as number[]);
          } else disarm();
        }} /> Enable commands</label>
        <button type="button" onClick={disarm}>Disarm + wheel zero</button>
      </div>
      <div className="crane-grid">
        <section className="crane-section">
          <button className="crane-section-heading" type="button" onClick={() => setJointOpen((v) => !v)} aria-expanded={jointOpen}>Joint positioning <span>{jointOpen ? "▾" : "▸"}</span></button>
          {jointOpen && <div className="crane-section-content">
            {JOINTS.map((joint, i) => <div className="crane-joint" key={joint.name}>
              <div className="crane-joint-title"><strong>{joint.label}</strong><span>Actual: {actual[i]?.toFixed(3) ?? "—"} {joint.unit}</span></div>
              <div className="crane-joint-controls">
                <button type="button" disabled={!publishReady} onClick={() => jog(i, -1)}>− Jog</button>
                <input aria-label={`${joint.label} target`} type="number" min={joint.min} max={joint.max} step="any" value={targets[i] ?? 0} onChange={(e) => { if (e.target.value !== "") setJointTarget(i, Number(e.target.value)); }} />
                <button type="button" disabled={!publishReady} onClick={() => jog(i, 1)}>+ Jog</button>
              </div>
              <div className="crane-joint-step"><label>Jog step ({joint.unit}) <input aria-label={`${joint.label} jog step`} type="number" min="0.0001" step="any" value={jogSteps[i]} onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v) && v > 0) setJogSteps((old) => old.map((n, idx) => idx === i ? v : n));
              }}/></label></div>
            </div>)}
            <div className="crane-actions"><button type="button" disabled={!publishReady} onClick={() => sendPositions(targetsRef.current)}>Send all targets</button><button type="button" disabled={!feedbackReceived} onClick={() => updateTargets(actualRef.current as number[])}>Copy measured positions</button></div>
            <p className="crane-hint">Jog uses measured positions for the other axes. “Send all” uses edited targets.</p>
          </div>}
        </section>
        <section className="crane-section">
          <button className="crane-section-heading" type="button" onClick={() => setWheelOpen((v) => !v)} aria-expanded={wheelOpen}>Wheel RPM <span>{wheelOpen ? "▾" : "▸"}</span></button>
          {wheelOpen && <div className="crane-section-content">
            {[0, 1].map((group) => <div className="crane-wheel" key={group}>
              <div className="crane-joint-title"><strong>Gimbal {group} wheels</strong><span>Target: {rpm[group]} RPM</span></div>
              <div className="crane-presets">{RPM_PRESETS.map((value) => <button key={value} type="button" className={rpm[group] === value ? "selected" : ""} disabled={!publishReady} onClick={() => {
                const next: Pair = [...rpmRef.current] as Pair;
                next[group] = value;
                sendWheelTargets(next);
              }}>{value === 0 ? "0" : `${value / 1000}k`}</button>)}</div>
            </div>)}
            <button className="crane-zero" type="button" disabled={!publishingAvailable} onClick={zeroWheels}>ZERO BOTH WHEEL TARGETS</button>
            <p className="crane-hint">Setpoints change immediately. Ramp limiting and emergency stop belong in the controller/firmware.</p>
          </div>}
        </section>
      </div>
      <footer className="crane-footer"><span role="status">{status}</span><small>{POSITION_TOPIC} · {WHEEL_TOPIC}</small></footer>
    </div>
  );
}

export function initCraneJointPanel(context: PanelExtensionContext): () => void {
  // The host element is the scrollport. Chrome/Foxglove may otherwise constrain
  // the React child to the panel's available height and clip its content.
  const host = context.panelElement;
  const original = {
    overflow: host.style.overflow,
    overflowX: host.style.overflowX,
    overflowY: host.style.overflowY,
    minHeight: host.style.minHeight,
    minWidth: host.style.minWidth,
    overscrollBehavior: host.style.overscrollBehavior,
  };
  host.style.overflowX = "hidden";
  host.style.overflowY = "auto";
  host.style.minHeight = "0";
  host.style.minWidth = "0";
  host.style.overscrollBehavior = "contain";

  const root = createRoot(host);
  root.render(<CranePanel context={context} />);
  return () => {
    root.unmount();
    host.style.overflow = original.overflow;
    host.style.overflowX = original.overflowX;
    host.style.overflowY = original.overflowY;
    host.style.minHeight = original.minHeight;
    host.style.minWidth = original.minWidth;
    host.style.overscrollBehavior = original.overscrollBehavior;
  };
}
