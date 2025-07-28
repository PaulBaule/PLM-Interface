import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, useMotionValue, useTransform, animate, type PanInfo, type AnimationOptions } from 'framer-motion';
import mqtt from 'mqtt';
import './SliderGesture.css';

// --- MQTT Settings ---
const MQTT_BROKER = "wss://broker.emqx.io:8084/mqtt";
const MQTT_TOPIC = "zotac/pico/control";
const MQTT_FADE_TOPIC = "zotac/pico/fading";

// --- Color Definitions ---
const colorNames = ["rose", "pfirsich", "creme", "mint", "himmelblau", "lavendel", "flieder"];
const keyColors = [
    [255, 191, 204], // rose
    [255, 217, 184], // pfirsich
    [255, 250, 204], // creme
    [153, 250, 153], // mint
    [135, 206, 235], // himmelblau
    [230, 230, 250], // lavendel
    [204, 159, 227]  // flieder
];

const SliderGesture: React.FC = () => {
    const [mqttClient, setMqttClient] = useState<mqtt.MqttClient | null>(null);
    const [lastFadeMessage, setLastFadeMessage] = useState("Position: 0.000");
    const [lastSequenceMessage, setLastSequenceMessage] = useState<string>("");
    const [isDragging, setIsDragging] = useState(false);
    const isDraggingRef = useRef(false);
    const [containerWidth, setContainerWidth] = useState(0);
    const [dotPositions, setDotPositions] = useState<number[]>([]);
    const [dotIsActive, setDotIsActive] = useState<boolean[]>(Array(7).fill(false));

    const constraintsRef = useRef<HTMLDivElement>(null);
    const dragStartPoint = useRef({ x: 0, y: 0 });

    const headX = useMotionValue(0);
    const tailX = useMotionValue(0);
    const x = useMotionValue(0);
    const width = useMotionValue(30);

    const animationFrameId = useRef<number | null>(null);
    const tailVelocity = useRef(0);
    const initialPositionPublished = useRef(false);

    useEffect(() => {
        isDraggingRef.current = isDragging;
    }, [isDragging]);

    const lastPublishTime = useRef(0);

    useEffect(() => {
        const THROTTLE_MS = 50; // Publish up to 20 times per second

        const handleTailChange = (latestTailX: number) => {
            const now = Date.now();
            if (now - lastPublishTime.current < THROTTLE_MS) {
                return; // Throttle the message sending
            }
            lastPublishTime.current = now;

            if (containerWidth > 0) {
                const normalizedPosition = Math.max(0, Math.min(1, latestTailX / containerWidth));
                const message = normalizedPosition.toFixed(3); // e.g., "0.458"
                setLastFadeMessage(`Position: ${message}`);

                if (mqttClient && mqttClient.connected) {
                    mqttClient.publish(MQTT_FADE_TOPIC, message, (err) => {
                        if (err) {
                            console.error(`MQTT Publish Error on topic ${MQTT_FADE_TOPIC}:`, err);
                        }
                    });
                }
            }
        };

        const unsubscribe = tailX.onChange(handleTailChange);
        return () => unsubscribe();
    }, [tailX, containerWidth, mqttClient]);

    // This effect ensures the initial slider position is published once connected.
    useEffect(() => {
        if (mqttClient && mqttClient.connected && containerWidth > 0 && !initialPositionPublished.current) {
            // The slider starts in the middle, which corresponds to a normalized value of 0.5.
            const initialNormalizedPosition = 0.5;
            const message = initialNormalizedPosition.toFixed(3);
            setLastFadeMessage(`Position: ${message}`);

            mqttClient.publish(MQTT_FADE_TOPIC, message, (err) => {
                if (err) {
                    console.error(`MQTT Publish Error on topic ${MQTT_FADE_TOPIC} for initial position:`, err);
                } else {
                    console.log(`Published initial position '${message}' to ${MQTT_FADE_TOPIC}`);
                }
            });
            initialPositionPublished.current = true;
        }
    }, [mqttClient, containerWidth]);


    // This effect will keep the visual slider element (defined by x and width)
    // in sync with the logical head and tail positions.
    useEffect(() => {
        const updateSliderProperties = () => {
            const h = headX.get();
            const t = tailX.get();
            const newX = Math.min(h, t) - 15; // Center the slider element
            const newWidth = Math.abs(h - t) + 30;
            x.set(newX);
            width.set(newWidth);
        };
        
        const unsubscribeHead = headX.onChange(updateSliderProperties);
        const unsubscribeTail = tailX.onChange(updateSliderProperties);

        return () => {
            unsubscribeHead();
            unsubscribeTail();
        };
    }, [headX, tailX, x, width]);

    useEffect(() => {
        if (constraintsRef.current) {
            const rect = constraintsRef.current.getBoundingClientRect();
            const containerWidth = rect.width;
            setContainerWidth(containerWidth);
            const sliderWidth = 30; // The resting width of the slider head

            // Calculate positions so the center of the slider aligns with the dots
            const trackWidth = containerWidth - sliderWidth;
            const newDotPositions = Array.from({ length: 7 }).map((_, i) => 
                (trackWidth / 6) * i + (sliderWidth / 2)
            );
            setDotPositions(newDotPositions);

            // Set initial position
            if (newDotPositions.length > 0) {
                const initialX = newDotPositions[Math.floor(newDotPositions.length / 2)];
                headX.set(initialX);
                tailX.set(initialX);
            }
        }
    }, []);

    // --- MQTT Connection ---
    useEffect(() => {
        try {
            console.log(`Connecting to MQTT Broker: ${MQTT_BROKER}`);
            const client = mqtt.connect(MQTT_BROKER, {
                // Empty credentials for anonymous access on some brokers
                username: '', 
                password: '',
            });

            client.on('connect', () => {
                console.log("Successfully connected to MQTT Broker!");
                setMqttClient(client);
            });

            client.on('error', (err) => {
                console.error("MQTT Connection Error: ", err);
                client.end();
            });
            
            return () => {
                if (client) {
                    console.log("Stopping MQTT Client.");
                    client.end();
                }
            };
        } catch (error) {
            console.error("Failed to connect to MQTT Broker:", error);
        }
    }, []);

    const publishMessage = useCallback((topic: string, message: string) => {
        if (mqttClient && mqttClient.connected) {
            mqttClient.publish(topic, message, (err) => {
                if (err) {
                    console.error("MQTT Publish Error:", err);
                } else {
                    console.log(`Published Geste: '${message}'`);
                }
            });
        } else {
            console.warn("MQTT client not connected. Message not sent.");
        }
    }, [mqttClient]);

    // --- UI & Color Calculations ---
    const getGradient = () => {
        const colorStops = keyColors.map((color, i) =>
            `rgb(${color.join(',')}) ${i / (keyColors.length - 1) * 100}%`
        );
        return `linear-gradient(to right, ${colorStops.join(', ')})`;
    };

    const backgroundPositionX = useTransform(x, value => -value);

    const stopTailAnimation = useCallback(() => {
        if (animationFrameId.current) {
            cancelAnimationFrame(animationFrameId.current);
            animationFrameId.current = null;
        }
    }, []);

    const runTailAnimation = useCallback(() => {
        stopTailAnimation(); // Ensure no multiple loops are running

        const PIXELS_PER_CM = 37.8;
        const MAX_SPEED_PX_PER_S = PIXELS_PER_CM * 1; // Tail speed
        let lastTime: number | null = null;

        const frame = (time: number) => {
            if (!isDraggingRef.current) {
                stopTailAnimation();
                return;
            }

            if (lastTime === null) {
                lastTime = time;
                animationFrameId.current = requestAnimationFrame(frame);
                return;
            }

            const deltaTime = (time - lastTime) / 1000; // in seconds
            lastTime = time;

            const hx = headX.get();
            const tx = tailX.get();
            const distance = hx - tx;
            const direction = Math.sign(distance);

            // If very close, reset velocity to prevent jittering and stop.
            if (Math.abs(distance) < 1) {
                tailVelocity.current = 0;
                animationFrameId.current = requestAnimationFrame(frame);
                return;
            }
            
            const targetVelocity = direction * MAX_SPEED_PX_PER_S;

            // Framerate-independent easing for acceleration/deceleration and direction changes
            const easingFactor = 1 - Math.exp(-4 * deltaTime); // Stiffness factor of 4
            tailVelocity.current += (targetVelocity - tailVelocity.current) * easingFactor;
            
            let newTailX = tx + tailVelocity.current * deltaTime;

            // Prevent overshooting and stop on contact.
            const currentDirection = Math.sign(tailVelocity.current);
            if (currentDirection > 0 && newTailX > hx) {
                newTailX = hx;
                tailVelocity.current = 0;
            } else if (currentDirection < 0 && newTailX < hx) {
                newTailX = hx;
                tailVelocity.current = 0;
            }
            
            tailX.set(newTailX);

            animationFrameId.current = requestAnimationFrame(frame);
        };

        animationFrameId.current = requestAnimationFrame(frame);

    }, [headX, tailX, stopTailAnimation]);


    const handlePanStart = (_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
        // Stop any leftover animations
        headX.stop();
        tailX.stop();
        stopTailAnimation();

        setIsDragging(true);
        const containerRect = constraintsRef.current?.getBoundingClientRect();
        if (!containerRect) return;

        const startX = info.point.x - containerRect.left;
        const startY = info.point.y - containerRect.top;
        dragStartPoint.current = { x: startX, y: startY };
        
        // Snap head to cursor, tail stays put initially
        headX.set(startX);
        runTailAnimation();
    };
    
    const handlePan = (_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
        const containerRect = constraintsRef.current?.getBoundingClientRect();
        if (!containerRect || !containerWidth) return;

        const currentX = info.point.x - containerRect.left;

        // Head follows the cursor, but constrained within the container bounds
        const restingWidth = 30;
        const constrainedX = Math.max(restingWidth / 2, Math.min(currentX, containerWidth - restingWidth / 2));
        headX.set(constrainedX);
    };

    const handlePanEnd = (_event: MouseEvent | TouchEvent | PointerEvent, _info: PanInfo) => {
        setIsDragging(false);
        stopTailAnimation();
        const containerRect = constraintsRef.current?.getBoundingClientRect();
        if (!containerRect || !containerWidth) return;

        const releaseX = headX.get();

        // Find the closest dot to snap to
        const closestDotX = dotPositions.reduce((prev, curr) => {
            return (Math.abs(curr - releaseX) < Math.abs(prev - releaseX) ? curr : prev);
        });

        // Calculate tail's animation duration first, as head's duration depends on it.
        const PIXELS_PER_CM = 37.8;
        const SPEED_CM_PER_S = 1;
        const speedPxPerS = PIXELS_PER_CM * SPEED_CM_PER_S;
        
        const distanceToTravel = Math.abs(tailX.get() - closestDotX);
        const tail_duration = distanceToTravel > 0 ? distanceToTravel / speedPxPerS : 0;

        // Head's duration is at least 3s, but waits for the tail if it's slower.
        const head_duration = Math.max(3, tail_duration);
        const head_anim_options: AnimationOptions = { type: "tween" as const, ease: "easeInOut", duration: head_duration };
        animate(headX, closestDotX, head_anim_options);

        // Animate tail to the final position at a constant speed
        const tail_anim_options: AnimationOptions = { type: "tween" as const, ease: "linear", duration: tail_duration };
        animate(tailX, closestDotX, {
            ...tail_anim_options,
            onComplete: () => {
                const finalHeadX = headX.get();
                const finalTailX = tailX.get();
                const sliderWidth = width.get();
                const restingWidth = 30;

                // Check if slider is at minimum width and both head/tail are at a dot position
                if (Math.abs(sliderWidth - restingWidth) < 1 && Math.abs(finalHeadX - finalTailX) < 1) {
                    const dotIndex = dotPositions.findIndex(dotPos => Math.abs(dotPos - finalHeadX) < 1);
                    if (dotIndex !== -1) {
                        const message = `Initialize Sequence ${dotIndex + 1}`;
                        publishMessage(MQTT_TOPIC, message);
                        setLastSequenceMessage(message);
                        setTimeout(() => setLastSequenceMessage(""), 3000); // Clear after 3 seconds
                        
                        setDotIsActive(prev => {
                            const newActive = [...prev];
                            newActive[dotIndex] = true;
                            return newActive;
                        });

                        // Reset the animation state after a short duration
                        setTimeout(() => {
                            setDotIsActive(prev => {
                                const newActive = [...prev];
                                newActive[dotIndex] = false;
                                return newActive;
                            });
                        }, 500); // 500ms animation duration
                    }
                }
            }
        });
    };


    return (
        <>
            <motion.div 
                className="slider-container" 
                ref={constraintsRef}
            >
                <div className="dots-container">
                    {dotPositions.map((pos, i) => (
                        <div key={i} className={`dot ${dotIsActive[i] ? 'dot-active' : ''}`} style={{ left: `${pos}px` }} />
                    ))}
                </div>
                <motion.div
                    className="stretchy-slider"
                    style={{
                        x,
                        width,
                        y: '-50%',
                        background: getGradient(),
                        backgroundSize: `${containerWidth}px 100%`,
                        backgroundPositionX,
                        backgroundRepeat: 'no-repeat',
                    }}
                />
                <motion.div
                    className="head-grab-area"
                    style={{
                        x: headX,
                        translateX: '-50%', // center the grab area on headX
                        position: 'absolute',
                        top: '0',
                        bottom: '0',
                        width: 30, // same as resting state width
                        cursor: 'grab',
                    }}
                    onPanStart={handlePanStart}
                    onPan={handlePan}
                    onPanEnd={handlePanEnd}
                    whileTap={{ cursor: "grabbing" }}
                />
            </motion.div>
            <div className="mqtt-status">
                {lastFadeMessage || "Waiting for position..."}
            </div>
            <div className="mqtt-status sequence-status">
                {lastSequenceMessage}
            </div>
        </>
    );
};

export default SliderGesture;
