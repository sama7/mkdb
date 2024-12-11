export default function CircleProgress({ percentage }) {
    // Map the percentage to a color gradient from blue to red
    const calculateColor = (percentage) => {
        const red = Math.min(255, Math.floor((percentage / 100) * 255));
        const blue = Math.min(255, Math.floor(((100 - percentage) / 100) * 255));
        return `rgb(${red}, 0, ${blue})`;
    };

    return (
        <div className="circle-border">
            <div
                className="circle-progress"
                style={{
                    background: `conic-gradient(${calculateColor(
                        percentage
                    )} ${percentage * 3.6}deg, #e0e0e0 ${percentage * 3.6}deg)`,
                }}
            >
                <div className="circle-inner">
                    <span className="percentage-text">{percentage}%</span>
                </div>
            </div>
        </div>
    );
};