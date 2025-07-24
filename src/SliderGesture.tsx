import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, useMotionValue, useTransform, animate, type PanInfo } from 'framer-motion';
import mqtt from 'mqtt';
import './SliderGesture.css';

// --- MQTT Settings ---
const MQTT_BROKER = "wss://broker.emqx.io:8084/mqtt";
const MQTT_TOPIC = "zotac/pico/control";

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
    const [lastMessage, setLastMessage] = useState("");
    const [isDragging, setIsDragging] = useState(false);
    const isDraggingRef = useRef(false);
    const [containerWidth, setContainerWidth] = useState(0);
    const [dotPositions, setDotPositions] = useState<number[]>([]);

    const constraintsRef = useRef<HTMLDivElement>(null);
    const dragStartPoint = useRef({ x: 0, y: 0 });

    const headX = useMotionValue(0);
    const tailX = useMotionValue(0);
    const x = useMotionValue(0);
    const width = useMotionValue(30);

    const animationFrameId = useRef<number | null>(null);

    useEffect(() => {
        isDraggingRef.current = isDragging;
    }, [isDragging]);

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
                client.subscribe(MQTT_TOPIC, (err) => {
                    if (err) {
                        console.error("MQTT Subscribe Error:", err);
                    } else {
                        console.log(`Subscribed to topic: ${MQTT_TOPIC}`);
                    }
                });
            });

            client.on('message', (topic, payload) => {
                const message = payload.toString();
                console.log(`Received message: ${message} on topic: ${topic}`);
                setLastMessage(message);
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

    const getColorNameAt = (position: number, trackWidth: number) => {
        if (trackWidth === 0) return "";
        const colorIndex = Math.floor((position / trackWidth) * colorNames.length);
        return colorNames[Math.max(0, Math.min(colorIndex, colorNames.length - 1))];
    };
    
    const stopTailAnimation = useCallback(() => {
        if (animationFrameId.current) {
            cancelAnimationFrame(animationFrameId.current);
            animationFrameId.current = null;
        }
    }, []);

    const runTailAnimation = useCallback(() => {
        stopTailAnimation(); // Ensure no multiple loops are running

        const PIXELS_PER_CM = 37.8;
        const SPEED_CM_PER_S = 1; // Tail speed
        const speedPxPerS = PIXELS_PER_CM * SPEED_CM_PER_S;
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

            if (Math.abs(distance) < 1) { // Threshold to stop jittering
                animationFrameId.current = requestAnimationFrame(frame);
                return;
            }

            const moveAmount = speedPxPerS * deltaTime;
            const direction = Math.sign(distance);
            
            let newTailX;
            if (direction > 0) {
                newTailX = Math.min(hx, tx + moveAmount);
            } else {
                newTailX = Math.max(hx, tx - moveAmount);
            }

            tailX.set(newTailX);

            animationFrameId.current = requestAnimationFrame(frame);
        };

        animationFrameId.current = requestAnimationFrame(frame);

    }, [headX, tailX, stopTailAnimation]);


    const handlePanStart = (event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
        headX.stop();
        tailX.stop();
        x.stop();
        width.stop();

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
    
    const handlePan = (event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
        const containerRect = constraintsRef.current?.getBoundingClientRect();
        if (!containerRect || !containerWidth) return;

        const currentX = info.point.x - containerRect.left;

        // Head follows the cursor
        headX.set(currentX);
    };

    const handlePanEnd = (event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
        setIsDragging(false);
        stopTailAnimation();
        const containerRect = constraintsRef.current?.getBoundingClientRect();
        if (!containerRect || !containerWidth) return;

        const releaseX = headX.get();

        // Find the closest dot to snap to
        const closestDotX = dotPositions.reduce((prev, curr) => {
            return (Math.abs(curr - releaseX) < Math.abs(prev - releaseX) ? curr : prev);
        });

        // Animate both head and tail to the closest dot.
        const anim_options = { type: "tween" as const, ease: "linear", duration: 5 };
        
        animate(headX, closestDotX, anim_options);
        animate(tailX, closestDotX, anim_options);
        
        // --- MQTT Logic ---
        const dx = info.offset.x;
        const dy = info.offset.y;
        
        const minDragDistance = 0;
        let direction = "tap";
        if (Math.abs(dx) > minDragDistance || Math.abs(dy) > minDragDistance) {
            if (Math.abs(dx) > Math.abs(dy)) {
                direction = dx > 0 ? "rechts" : "links";
            } else {
                direction = dy > 0 ? "runter" : "hoch";
            }
        }
        
        const startColorName = getColorNameAt(dragStartPoint.current.x, containerRect.width);
        
        const message = `geste_${startColorName}_${direction}`;
        publishMessage(MQTT_TOPIC, message);
    };


    return (
        <>
            <motion.div 
                className="slider-container" 
                ref={constraintsRef}
            >
                <div className="dots-container">
                    {dotPositions.map((pos, i) => (
                        <div key={i} className="dot" style={{ left: `${pos}px` }} />
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
                Last Message: {lastMessage || "None"}
            </div>
        </>
    );
};

export default SliderGesture;
