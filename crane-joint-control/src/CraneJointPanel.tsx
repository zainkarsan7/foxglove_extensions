import {
  PanelExtensionContext} from "@foxglove/extension";
import React, { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

const COMMAND_TOPIC = "/joint_position_controller/commands";
const COMMAND_SCHEMA = "std_msgs/msg/Float64MultiArray";
const WHEEL_TOPIC = "/velocity_position_controller/commands";

type Float64MultiArray = {
  layout: {
    dim: unknown[];
    data_offset: number;
  };
  data: number[];
};

type JointControlProps = {
  context: PanelExtensionContext;
};

function JointControl({ context }: JointControlProps): React.JSX.Element {
  const [swivel, setSwivel] = useState(0);
  const [left, setLeft] = useState(0);
  const [right, setRight] = useState(0);
  const [G0, setG0] = useState(0);
  const [G1, setG1] = useState(0);

  const [publishingAvailable, setPublishingAvailable] = useState(
    context.advertise != undefined && context.publish != undefined,
  );

  useEffect(() => {
    if (context.advertise == undefined) {
      setPublishingAvailable(false);
      return;
    }

    context.advertise(COMMAND_TOPIC, COMMAND_SCHEMA);

    return () => {
      context.unadvertise?.(COMMAND_TOPIC);
    };
  }, [context]);

  const publishPositions = useCallback(() => {
    if (context.publish == undefined) {
      console.error("Current Foxglove connection does not support publishing");
      return;
    }

    const message: Float64MultiArray = {
      layout: {
        dim: [],
        data_offset: 0,
      },
      data: [swivel, left, right, G0, G1],
    };

    context.publish(COMMAND_TOPIC, message);
  }, [context, swivel, left, right, G0, G1]);

  const stopAndHold = useCallback(() => {
    /*
     * For a position controller, "stop" means stop changing the target.
     * Publishing zeros would command the crane to move to zero, so this
     * button simply republishes the current target.
     */
    publishPositions();
  }, [publishPositions]);

  return (
    <div
      style={{
        padding: "1rem",
        display: "flex",
        flexDirection: "column",
        gap: "1rem",
        fontFamily: "sans-serif",
      }}
    >
      <h2 style={{ margin: 0 }}>Crane Joint Control</h2>

      {!publishingAvailable && (
        <div
          style={{
            padding: "0.75rem",
            border: "1px solid",
            borderRadius: "4px",
          }}
        >
          The current Foxglove connection does not support publishing.
        </div>
      )}

      <JointInput
        label="Swivel"
        units="rad"
        value={swivel}
        min={-3.14}
        max={3.14}
        step={0.01}
        onChange={setSwivel}
      />

      <JointInput
        label="Left linear joint"
        units="m"
        value={left}
        min={0}
        max={1}
        step={0.005}
        onChange={setLeft}
      />

      <JointInput
        label="Right linear joint"
        units="m"
        value={right}
        min={0}
        max={1}
        step={0.005}
        onChange={setRight}
      />

      <JointInput
        label="G0 revolute joint"
        units="rad"
        value={G0}
        min={-3.14}
        max={3.14}
        step={0.01}
        onChange={setG0}
      />

      <JointInput
        label="G1 revolute joint"
        units="rad"
        value={G1}
        min={-3.14}
        max={3.14}
        step={0.01}
        onChange={setG1}
      />

      <button
        disabled={!publishingAvailable}
        onClick={publishPositions}
        style={{
          padding: "0.75rem",
          fontSize: "1rem",
          cursor: publishingAvailable ? "pointer" : "not-allowed",
        }}
      >
        Send joint target
      </button>

      <button
        disabled={!publishingAvailable}
        onClick={stopAndHold}
        style={{
          padding: "0.75rem",
          fontSize: "1rem",
          cursor: publishingAvailable ? "pointer" : "not-allowed",
        }}
      >
        Hold current target
      </button>

      <code style={{ wordBreak: "break-all" }}>
        {COMMAND_TOPIC}
      </code>
    </div>
  );
}

type JointInputProps = {
  label: string;
  units: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
};

function JointInput({
  label,
  units,
  value,
  min,
  max,
  step,
  onChange,
}: JointInputProps): React.JSX.Element {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
      <span>
        {label}: {value.toFixed(3)} {units}
      </span>

      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(Number(event.target.value))}
      />

      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => {
          const parsed = Number(event.target.value);

          if (Number.isFinite(parsed)) {
            onChange(Math.min(max, Math.max(min, parsed)));
          }
        }}
      />
    </label>
  );
}

export function initCraneJointPanel(
  context: PanelExtensionContext,
): () => void {
  const root = createRoot(context.panelElement);

  root.render(<JointControl context={context} />);

  // context.onRender = (
  //   _renderState: RenderState,
  //   done: () => void,
  // ): void => {
  //   done();
  // };

  context.watch("currentTime");

  return () => {
    root.unmount();
  };
}