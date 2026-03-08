import { XMLParser } from "fast-xml-parser";
import { readFile } from "fs/promises";

// -- Types for parsed Apple Health data --

export interface HealthRecord {
  type: string;
  sourceName: string;
  unit: string;
  value: string;
  startDate: string;
  endDate: string;
  creationDate: string;
}

export interface WorkoutRecord {
  activityType: string;
  duration: string;
  durationUnit: string;
  totalDistance: string;
  distanceUnit: string;
  totalEnergyBurned: string;
  energyUnit: string;
  sourceName: string;
  startDate: string;
  endDate: string;
}

export interface HealthData {
  records: HealthRecord[];
  workouts: WorkoutRecord[];
  recordTypes: string[];
  dateRange: { earliest: string; latest: string };
}

// Mapping Apple's internal type identifiers to readable names
const TYPE_LABELS: Record<string, string> = {
  HKQuantityTypeIdentifierStepCount: "Steps",
  HKQuantityTypeIdentifierHeartRate: "Heart Rate",
  HKQuantityTypeIdentifierRestingHeartRate: "Resting Heart Rate",
  HKQuantityTypeIdentifierWalkingHeartRateAverage: "Walking Heart Rate Avg",
  HKQuantityTypeIdentifierHeartRateVariabilitySDNN: "HRV (SDNN)",
  HKQuantityTypeIdentifierBodyMass: "Body Mass",
  HKQuantityTypeIdentifierHeight: "Height",
  HKQuantityTypeIdentifierBodyFatPercentage: "Body Fat %",
  HKQuantityTypeIdentifierBodyMassIndex: "BMI",
  HKQuantityTypeIdentifierActiveEnergyBurned: "Active Energy Burned",
  HKQuantityTypeIdentifierBasalEnergyBurned: "Basal Energy Burned",
  HKQuantityTypeIdentifierDistanceWalkingRunning: "Walking/Running Distance",
  HKQuantityTypeIdentifierDistanceCycling: "Cycling Distance",
  HKQuantityTypeIdentifierFlightsClimbed: "Flights Climbed",
  HKQuantityTypeIdentifierAppleExerciseTime: "Exercise Time",
  HKQuantityTypeIdentifierAppleStandTime: "Stand Time",
  HKQuantityTypeIdentifierOxygenSaturation: "Blood Oxygen",
  HKQuantityTypeIdentifierBloodPressureSystolic: "Blood Pressure Systolic",
  HKQuantityTypeIdentifierBloodPressureDiastolic: "Blood Pressure Diastolic",
  HKQuantityTypeIdentifierRespiratoryRate: "Respiratory Rate",
  HKQuantityTypeIdentifierBodyTemperature: "Body Temperature",
  HKQuantityTypeIdentifierBloodGlucose: "Blood Glucose",
  HKQuantityTypeIdentifierDietaryEnergyConsumed: "Dietary Energy",
  HKQuantityTypeIdentifierDietaryProtein: "Dietary Protein",
  HKQuantityTypeIdentifierDietaryCarbohydrates: "Dietary Carbs",
  HKQuantityTypeIdentifierDietaryFatTotal: "Dietary Fat",
  HKQuantityTypeIdentifierDietaryWater: "Water Intake",
  HKQuantityTypeIdentifierDietaryCaffeine: "Caffeine",
  HKQuantityTypeIdentifierVO2Max: "VO2 Max",
  HKQuantityTypeIdentifierWalkingDoubleSupportPercentage: "Walking Double Support %",
  HKQuantityTypeIdentifierWalkingSpeed: "Walking Speed",
  HKQuantityTypeIdentifierWalkingStepLength: "Walking Step Length",
  HKQuantityTypeIdentifierWalkingAsymmetryPercentage: "Walking Asymmetry %",
  HKQuantityTypeIdentifierAppleWalkingSteadiness: "Walking Steadiness",
  HKQuantityTypeIdentifierEnvironmentalAudioExposure: "Environmental Audio Exposure",
  HKQuantityTypeIdentifierHeadphoneAudioExposure: "Headphone Audio Exposure",
  HKCategoryTypeIdentifierSleepAnalysis: "Sleep Analysis",
  HKCategoryTypeIdentifierMindfulSession: "Mindful Session",
  HKCategoryTypeIdentifierAppleStandHour: "Stand Hour",
};

const WORKOUT_LABELS: Record<string, string> = {
  HKWorkoutActivityTypeRunning: "Running",
  HKWorkoutActivityTypeWalking: "Walking",
  HKWorkoutActivityTypeCycling: "Cycling",
  HKWorkoutActivityTypeSwimming: "Swimming",
  HKWorkoutActivityTypeYoga: "Yoga",
  HKWorkoutActivityTypeFunctionalStrengthTraining: "Strength Training",
  HKWorkoutActivityTypeTraditionalStrengthTraining: "Strength Training",
  HKWorkoutActivityTypeHighIntensityIntervalTraining: "HIIT",
  HKWorkoutActivityTypeCoreTraining: "Core Training",
  HKWorkoutActivityTypeElliptical: "Elliptical",
  HKWorkoutActivityTypeRowing: "Rowing",
  HKWorkoutActivityTypeHiking: "Hiking",
  HKWorkoutActivityTypeDance: "Dance",
  HKWorkoutActivityTypeCooldown: "Cooldown",
  HKWorkoutActivityTypeMixedCardio: "Mixed Cardio",
  HKWorkoutActivityTypePilates: "Pilates",
};

export function labelForType(type: string): string {
  return TYPE_LABELS[type] ?? type.replace(/HK\w+TypeIdentifier/, "");
}

export function labelForWorkout(type: string): string {
  return WORKOUT_LABELS[type] ?? type.replace("HKWorkoutActivityType", "");
}

export async function parseHealthExport(filePath: string): Promise<HealthData> {
  const xml = await readFile(filePath, "utf-8");

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    isArray: (tagName) => tagName === "Record" || tagName === "Workout",
  });

  const parsed = parser.parse(xml);
  const healthData = parsed.HealthData;

  if (!healthData) {
    throw new Error(
      "Invalid Apple Health export — missing <HealthData> root element. " +
        "Make sure you provide the 'Export.xml' file from your Apple Health export."
    );
  }

  const rawRecords: any[] = healthData.Record ?? [];
  const rawWorkouts: any[] = healthData.Workout ?? [];

  const records: HealthRecord[] = rawRecords.map((r: any) => ({
    type: r.type ?? "",
    sourceName: r.sourceName ?? "",
    unit: r.unit ?? "",
    value: r.value ?? "",
    startDate: r.startDate ?? "",
    endDate: r.endDate ?? "",
    creationDate: r.creationDate ?? "",
  }));

  const workouts: WorkoutRecord[] = rawWorkouts.map((w: any) => ({
    activityType: w.workoutActivityType ?? "",
    duration: w.duration ?? "",
    durationUnit: w.durationUnit ?? "min",
    totalDistance: w.totalDistance ?? "",
    distanceUnit: w.totalDistanceUnit ?? "",
    totalEnergyBurned: w.totalEnergyBurned ?? "",
    energyUnit: w.totalEnergyBurnedUnit ?? "",
    sourceName: w.sourceName ?? "",
    startDate: w.startDate ?? "",
    endDate: w.endDate ?? "",
  }));

  const recordTypes = [...new Set(records.map((r) => r.type))].sort();

  let earliest = "";
  let latest = "";
  for (const r of records) {
    if (!earliest || r.startDate < earliest) earliest = r.startDate;
    if (!latest || r.endDate > latest) latest = r.endDate;
  }

  return { records, workouts, recordTypes, dateRange: { earliest, latest } };
}
