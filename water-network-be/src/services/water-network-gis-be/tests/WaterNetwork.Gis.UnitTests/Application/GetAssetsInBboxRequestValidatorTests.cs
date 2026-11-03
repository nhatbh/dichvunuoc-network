using FluentValidation.TestHelper;
using Microsoft.Extensions.Options;
using WaterNetwork.Gis.Api.Validators;
using WaterNetwork.Gis.Application.Configuration;
using WaterNetwork.Gis.Contracts.Requests;
using Xunit;

namespace WaterNetwork.Gis.UnitTests.Application;

public class GetAssetsInBboxRequestValidatorTests
{
    private static GetAssetsInBboxRequestValidator CreateValidator() =>
        new(Options.Create(new BboxQueryOptions
        {
            MaxAreaSquareDegrees = 1.0,
            DefaultLimit = 2000,
            MaxLimit = 10000
        }));

    [Fact]
    public void Valid_Request_Passes()
    {
        var result = CreateValidator().TestValidate(
            new GetAssetsInBboxRequest("106.6,10.7,106.7,10.8", "node,pipe", 500));
        result.ShouldNotHaveAnyValidationErrors();
    }

    [Fact]
    public void Missing_Bbox_Fails()
    {
        var result = CreateValidator().TestValidate(new GetAssetsInBboxRequest(null, null, null));
        result.ShouldHaveValidationErrorFor(x => x.Bbox);
    }

    [Fact]
    public void Bbox_Not_Four_Numbers_Fails()
    {
        var result = CreateValidator().TestValidate(new GetAssetsInBboxRequest("106.6,10.7,106.7", null, null));
        result.ShouldHaveValidationErrorFor("Bbox");
    }

    [Fact]
    public void Bbox_Inverted_Lng_Fails()
    {
        var result = CreateValidator().TestValidate(new GetAssetsInBboxRequest("106.7,10.7,106.6,10.8", null, null));
        result.ShouldHaveValidationErrorFor("Bbox");
    }

    [Fact]
    public void Bbox_Inverted_Lat_Fails()
    {
        var result = CreateValidator().TestValidate(new GetAssetsInBboxRequest("106.6,10.8,106.7,10.7", null, null));
        result.ShouldHaveValidationErrorFor("Bbox");
    }

    [Fact]
    public void Bbox_Out_Of_Coordinate_Range_Fails()
    {
        var result = CreateValidator().TestValidate(new GetAssetsInBboxRequest("106.6,10.7,200.0,10.8", null, null));
        result.ShouldHaveValidationErrorFor("Bbox");
    }

    [Fact]
    public void Bbox_Area_Too_Large_Fails()
    {
        var result = CreateValidator().TestValidate(new GetAssetsInBboxRequest("100.0,10.0,102.0,12.0", null, null));
        result.ShouldHaveValidationErrorFor("Bbox");
    }

    [Fact]
    public void Limit_Zero_Fails()
    {
        var result = CreateValidator().TestValidate(new GetAssetsInBboxRequest("106.6,10.7,106.7,10.8", null, 0));
        result.ShouldHaveValidationErrorFor(x => x.Limit);
    }

    [Fact]
    public void Limit_Above_Max_Fails()
    {
        var result = CreateValidator().TestValidate(new GetAssetsInBboxRequest("106.6,10.7,106.7,10.8", null, 10001));
        result.ShouldHaveValidationErrorFor(x => x.Limit);
    }

    [Fact]
    public void Invalid_Type_Token_Fails()
    {
        var result = CreateValidator().TestValidate(new GetAssetsInBboxRequest("106.6,10.7,106.7,10.8", "node,zone", null));
        result.ShouldHaveValidationErrorFor(x => x.Types);
    }

    [Fact]
    public void Null_Types_Passes_Means_All()
    {
        var result = CreateValidator().TestValidate(new GetAssetsInBboxRequest("106.6,10.7,106.7,10.8", null, null));
        result.ShouldNotHaveValidationErrorFor(x => x.Types);
    }
}
