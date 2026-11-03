namespace WaterPlatform.BuildingBlocks.Domain.Events;

public interface ISerializedDomainEvent : IDomainEvent
{
    string Payload { get; }
}
